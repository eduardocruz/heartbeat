import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
import { createDatabase, getDefaultDbPath } from "../src/db";
import { Executor } from "../src/executor";
import { createApp } from "../src/server/app";

const cleanupPaths: string[] = [];

function sh(command: string, cwd?: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("database and task API", () => {
  test("creates database at ~/.heartbeat/heartbeat.db when no override is set", () => {
    const prevDbPath = process.env.HEARTBEAT_DB_PATH;
    const prevHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "heartbeat-home-"));
    cleanupPaths.push(tempHome);

    delete process.env.HEARTBEAT_DB_PATH;
    process.env.HOME = tempHome;

    const expectedPath = join(tempHome, ".heartbeat", "heartbeat.db");
    expect(getDefaultDbPath()).toBe(expectedPath);

    const db = createDatabase();
    db.close();

    expect(existsSync(expectedPath)).toBe(true);

    if (prevDbPath === undefined) {
      delete process.env.HEARTBEAT_DB_PATH;
    } else {
      process.env.HEARTBEAT_DB_PATH = prevDbPath;
    }

    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
  });

  test("supports create/list/filter/get/update task flows", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Implement CRUD",
        description: "Build API",
        priority: "high",
        agent: "codex",
        repo_url: "https://github.com/eduardocruz/heartbeat",
      }),
    });

    expect(createResp.status).toBe(201);
    const created = await createResp.json();
    expect(typeof created.id).toBe("string");
    expect(created.status).toBe("pending");

    const listResp = await app.request("/api/tasks");
    expect(listResp.status).toBe(200);
    const list = await listResp.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);

    const filterResp = await app.request("/api/tasks?status=pending");
    expect(filterResp.status).toBe(200);
    const filtered = await filterResp.json();
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(created.id);

    const getResp = await app.request(`/api/tasks/${created.id}`);
    expect(getResp.status).toBe(200);

    const beforeUpdate = await getResp.json();
    const patchResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });

    expect(patchResp.status).toBe(200);
    const updated = await patchResp.json();
    expect(updated.status).toBe("running");
    expect(updated.updated_at >= beforeUpdate.updated_at).toBe(true);

    db.close();
  });

  test("executes tasks sequentially and reports executor status", async () => {
    const db = createDatabase(":memory:");
    const executor = new Executor(db);
    const app = createApp(db, executor);

    const createAgent = async (name: string, commandTemplate: string) => {
      const resp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: "custom",
          command_template: commandTemplate,
        }),
      });
      expect(resp.status).toBe(201);
    };

    await createAgent("echo-agent", "echo hello");
    await createAgent("timeout-agent", "sleep 2");
    await createAgent("invalid-agent", "definitely-not-a-command");
    await createAgent("git-agent", "pwd");

    const createTask = async (payload: Record<string, unknown>) => {
      const resp = await app.request("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(resp.status).toBe(201);
      return resp.json();
    };

    const doneTask = await createTask({
      title: "Echo",
      agent: "echo-agent",
      timeout_seconds: 10,
    });
    const timeoutTask = await createTask({
      title: "Sleep",
      agent: "timeout-agent",
      timeout_seconds: 1,
    });
    const invalidTask = await createTask({
      title: "Invalid",
      agent: "invalid-agent",
      timeout_seconds: 10,
    });
    const sourceRepo = mkdtempSync(join(tmpdir(), "heartbeat-source-repo-"));
    cleanupPaths.push(sourceRepo);
    sh("git init --initial-branch=main", sourceRepo);
    writeFileSync(join(sourceRepo, "README.md"), "heartbeat\n");
    sh("git add README.md", sourceRepo);
    sh("git -c user.name='Test User' -c user.email='test@example.com' commit -m 'init'", sourceRepo);
    const repoHead = sh("git rev-parse HEAD", sourceRepo);

    const gitTask = await createTask({
      title: "Git",
      agent: "git-agent",
      repo_url: sourceRepo,
      timeout_seconds: 10,
    });

    const missingRepoTask = await createTask({
      title: "Missing repo",
      agent: "git-agent",
      repo_url: join(sourceRepo, "does-not-exist"),
      timeout_seconds: 10,
    });

    const statusBeforeResp = await app.request("/api/executor/status");
    expect(statusBeforeResp.status).toBe(200);
    const statusBefore = await statusBeforeResp.json();
    expect(statusBefore.queueLength).toBe(5);
    expect(statusBefore.runningTasks).toBe(0);

    await executor.checkForWork();

    const doneResp = await app.request(`/api/tasks/${doneTask.id}`);
    const done = await doneResp.json();
    expect(done.status).toBe("done");
    expect(done.stdout).toBe("hello\n");

    const timeoutResp = await app.request(`/api/tasks/${timeoutTask.id}`);
    const timeout = await timeoutResp.json();
    expect(timeout.status).toBe("failed");
    expect(timeout.stderr).toContain("timeout after 1s");

    const invalidResp = await app.request(`/api/tasks/${invalidTask.id}`);
    const invalid = await invalidResp.json();
    expect(invalid.status).toBe("failed");
    expect(typeof invalid.stderr).toBe("string");
    expect(invalid.stderr.length).toBeGreaterThan(0);

    const gitResp = await app.request(`/api/tasks/${gitTask.id}`);
    const gitDone = await gitResp.json();
    expect(gitDone.status).toBe("done");
    expect(gitDone.stdout).toContain(`${join(process.env.HOME ?? "", ".heartbeat", "workspaces", gitTask.id)}`);
    expect(gitDone.commit_hash).toBe(repoHead);

    const missingRepoResp = await app.request(`/api/tasks/${missingRepoTask.id}`);
    const missingRepo = await missingRepoResp.json();
    expect(missingRepo.status).toBe("failed");
    expect(String(missingRepo.stderr)).toContain("workspace setup failed");

    const statusAfterResp = await app.request("/api/executor/status");
    const statusAfter = await statusAfterResp.json();
    expect(statusAfter.queueLength).toBe(0);
    expect(statusAfter.runningTasks).toBe(0);
    expect(typeof statusAfter.lastPollAt).toBe("string");

    db.close();
  });
});
