import { describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db";
import { createApp } from "../src/server/app";
import { Executor } from "../src/executor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createAgent(app: ReturnType<typeof createApp>, name = "test-agent") {
  const res = await app.request("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type: "custom", command_template: "echo ok" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createTask(
  app: ReturnType<typeof createApp>,
  agentName: string,
  tool?: string,
) {
  const body: Record<string, unknown> = {
    title: "Test task",
    agent: agentName,
    status: "todo",
  };
  if (tool !== undefined) {
    body.tool = tool;
  }
  const res = await app.request("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

// ---------------------------------------------------------------------------
// Policy API tests
// ---------------------------------------------------------------------------

describe("agent policy API", () => {
  test("GET /api/agents/:id/policy returns 404 for unknown agent", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const res = await app.request("/api/agents/nonexistent-id/policy");
    expect(res.status).toBe(404);
    db.close();
  });

  test("GET /api/agents/:id/policy returns empty policy when none configured", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const agent = await createAgent(app);

    const res = await app.request(`/api/agents/${agent.id}/policy`);
    expect(res.status).toBe(200);
    const policy = (await res.json()) as { denied_tools: string[]; approval_required_tools: string[] };
    expect(policy.denied_tools).toEqual([]);
    expect(policy.approval_required_tools).toEqual([]);
    db.close();
  });

  test("PUT /api/agents/:id/policy sets denied_tools and approval_required_tools", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const agent = await createAgent(app);

    const res = await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        denied_tools: ["bash", "git_push"],
        approval_required_tools: ["deploy"],
      }),
    });
    expect(res.status).toBe(200);
    const policy = (await res.json()) as { denied_tools: string[]; approval_required_tools: string[] };
    expect(policy.denied_tools).toContain("bash");
    expect(policy.denied_tools).toContain("git_push");
    expect(policy.approval_required_tools).toContain("deploy");
    db.close();
  });

  test("GET /api/agents/:id/policy returns stored policy", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const agent = await createAgent(app);

    await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        denied_tools: ["web_search"],
        approval_required_tools: ["git_commit"],
      }),
    });

    const res = await app.request(`/api/agents/${agent.id}/policy`);
    expect(res.status).toBe(200);
    const policy = (await res.json()) as { denied_tools: string[]; approval_required_tools: string[] };
    expect(policy.denied_tools).toEqual(["web_search"]);
    expect(policy.approval_required_tools).toEqual(["git_commit"]);
    db.close();
  });

  test("PUT /api/agents/:id/policy rejects unknown tool names", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const agent = await createAgent(app);

    const res = await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        denied_tools: ["totally_fake_tool_xyz"],
        approval_required_tools: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unknown tool/i);
    db.close();
  });

  test("PUT /api/agents/:id/policy rejects tool in both denied and approval_required", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const agent = await createAgent(app);

    const res = await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        denied_tools: ["bash"],
        approval_required_tools: ["bash"],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/conflict|both|circular/i);
    db.close();
  });

  test("PUT /api/agents/:id/policy returns 404 for unknown agent", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const res = await app.request("/api/agents/nonexistent-id/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_tools: [], approval_required_tools: [] }),
    });
    expect(res.status).toBe(404);
    db.close();
  });

  test("PUT /api/agents/:id/policy overwrites previous policy", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const agent = await createAgent(app);

    await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_tools: ["bash"], approval_required_tools: [] }),
    });

    await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_tools: ["deploy"], approval_required_tools: ["git_push"] }),
    });

    const res = await app.request(`/api/agents/${agent.id}/policy`);
    const policy = (await res.json()) as { denied_tools: string[]; approval_required_tools: string[] };
    expect(policy.denied_tools).toEqual(["deploy"]);
    expect(policy.approval_required_tools).toEqual(["git_push"]);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Policy enforcement in executor
// ---------------------------------------------------------------------------

describe("policy enforcement in executor", () => {
  test("executor fails task immediately when its tool is denied", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const executor = new Executor(db);

    const agent = await createAgent(app, "policy-deny-agent");

    // Set deny policy
    await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_tools: ["bash"], approval_required_tools: [] }),
    });

    const task = await createTask(app, agent.name, "bash");

    await executor.executeTask({
      id: task.id,
      title: "Test task",
      description: null,
      agent: agent.name,
      repo_url: null,
      branch: null,
      timeout_seconds: null,
      status: "todo",
      tool: "bash",
    });

    const updated = db.query("SELECT status, stderr FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      stderr: string | null;
    };
    expect(updated.status).toBe("failed");
    expect(updated.stderr).toMatch(/denied|policy/i);
    db.close();
  });

  test("executor blocks task and creates approval when tool requires approval", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const executor = new Executor(db);

    const agent = await createAgent(app, "policy-approval-agent");

    // Set approval-required policy
    await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_tools: [], approval_required_tools: ["deploy"] }),
    });

    const task = await createTask(app, agent.name, "deploy");

    await executor.executeTask({
      id: task.id,
      title: "Test task",
      description: null,
      agent: agent.name,
      repo_url: null,
      branch: null,
      timeout_seconds: null,
      status: "todo",
      tool: "deploy",
    });

    const updatedTask = db.query("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
    expect(updatedTask.status).toBe("blocked");

    const approval = db
      .query("SELECT * FROM approvals WHERE task_id = ? AND status = 'pending'")
      .get(task.id) as { id: string; reason: string } | null;
    expect(approval).not.toBeNull();
    expect(approval?.reason).toMatch(/approval required|policy/i);
    db.close();
  });

  test("executor proceeds normally when task has no tool and agent has policy", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const executor = new Executor(db);

    const agent = await createAgent(app, "policy-no-tool-agent");

    await app.request(`/api/agents/${agent.id}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_tools: ["bash"], approval_required_tools: ["deploy"] }),
    });

    const task = await createTask(app, agent.name);

    await executor.executeTask({
      id: task.id,
      title: "Test task",
      description: null,
      agent: agent.name,
      repo_url: null,
      branch: null,
      timeout_seconds: null,
      status: "todo",
      tool: null,
    });

    const updatedTask = db.query("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
    // Should not be blocked or failed due to policy - it ran (may succeed or fail for other reasons)
    expect(updatedTask.status).not.toBe("blocked");
    db.close();
  });

  test("executor proceeds normally when agent has no policy configured", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const executor = new Executor(db);

    const agent = await createAgent(app, "policy-none-agent");
    const task = await createTask(app, agent.name, "bash");

    await executor.executeTask({
      id: task.id,
      title: "Test task",
      description: null,
      agent: agent.name,
      repo_url: null,
      branch: null,
      timeout_seconds: null,
      status: "todo",
      tool: "bash",
    });

    // No policy = no block; task should proceed (echo ok → done)
    const updatedTask = db.query("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
    expect(updatedTask.status).toBe("done");
    db.close();
  });
});
