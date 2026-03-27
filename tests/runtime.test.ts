import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../src/db/migrations";
import { RuntimeRegistry, validateRuntimeConfig } from "../src/executor/runtime";
import type { AgentRuntime, AgentRuntimeConfig, RuntimeDependencies, RuntimeDispatchInput, RuntimeDispatchResult } from "../src/executor/runtime";
import { CliRuntime } from "../src/executor/cli-runtime";
import { ClaudeAgentSdkRuntime } from "../src/executor/claude-sdk-runtime";
import { SqliteGovernancePolicyEngine } from "../src/executor/governance";
import { createRuntimeDependencies } from "../src/executor/runtime-deps";
import { bootstrapRuntimeRegistry } from "../src/executor/bootstrap";

function createTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("RuntimeRegistry", () => {
  test("registers and resolves runtimes", () => {
    const registry = new RuntimeRegistry();
    const db = createTestDb();
    const cli = new CliRuntime(db);

    registry.register(cli);

    expect(registry.has("cli")).toBe(true);
    expect(registry.has("claude-agent-sdk")).toBe(false);
    expect(registry.list()).toEqual(["cli"]);
    expect(registry.get("cli")).toBe(cli);
  });

  test("resolve throws for unregistered runtime", () => {
    const registry = new RuntimeRegistry();
    const config: AgentRuntimeConfig = {
      id: "test",
      name: "test",
      runtime: "claude-agent-sdk",
      model: "sonnet",
    };

    expect(() => registry.resolve(config)).toThrow("No runtime registered");
  });

  test("resolve validates config", () => {
    const registry = new RuntimeRegistry();
    const db = createTestDb();
    registry.register(new CliRuntime(db));

    const config: AgentRuntimeConfig = {
      id: "test",
      name: "test",
      runtime: "cli",
      commandTemplate: "", // empty — should fail
    };

    expect(() => registry.resolve(config)).toThrow("non-empty commandTemplate");
  });
});

describe("validateRuntimeConfig", () => {
  test("CLI runtime requires commandTemplate", () => {
    const errors = validateRuntimeConfig({
      id: "1", name: "t", runtime: "cli",
    });
    expect(errors).toContain("CLI runtime requires a non-empty commandTemplate");
  });

  test("SDK runtime requires model", () => {
    const errors = validateRuntimeConfig({
      id: "1", name: "t", runtime: "claude-agent-sdk",
    });
    expect(errors.some(e => e.includes("requires a model"))).toBe(true);
  });

  test("valid CLI config passes", () => {
    const errors = validateRuntimeConfig({
      id: "1", name: "t", runtime: "cli", commandTemplate: "echo hello",
    });
    expect(errors).toEqual([]);
  });

  test("valid SDK config passes", () => {
    const errors = validateRuntimeConfig({
      id: "1", name: "t", runtime: "claude-agent-sdk", model: "sonnet",
    });
    expect(errors).toEqual([]);
  });

  test("overlapping tools and disallowedTools rejected", () => {
    const errors = validateRuntimeConfig({
      id: "1", name: "t", runtime: "claude-agent-sdk", model: "sonnet",
      tools: ["Read", "Write"], disallowedTools: ["Write"],
    });
    expect(errors.some(e => e.includes("tools and disallowedTools"))).toBe(true);
  });

  test("approvalRequired must be subset of tools", () => {
    const errors = validateRuntimeConfig({
      id: "1", name: "t", runtime: "claude-agent-sdk", model: "sonnet",
      tools: ["Read"], approvalRequired: ["Write"],
    });
    expect(errors.some(e => e.includes("approvalRequired tools must be in allowed tools"))).toBe(true);
  });
});

describe("CliRuntime", () => {
  test("kind is cli", () => {
    const db = createTestDb();
    const rt = new CliRuntime(db);
    expect(rt.kind).toBe("cli");
    expect(rt.canResume()).toBe(false);
  });

  test("validate rejects empty command template", () => {
    const db = createTestDb();
    const rt = new CliRuntime(db);
    expect(() => rt.validate({ id: "1", name: "t", runtime: "cli" })).toThrow();
  });
});

describe("ClaudeAgentSdkRuntime", () => {
  test("kind is claude-agent-sdk", () => {
    const db = createTestDb();
    const rt = new ClaudeAgentSdkRuntime(db);
    expect(rt.kind).toBe("claude-agent-sdk");
    expect(rt.canResume()).toBe(true);
  });

  test("validate rejects missing model", () => {
    const db = createTestDb();
    const rt = new ClaudeAgentSdkRuntime(db);
    expect(() => rt.validate({ id: "1", name: "t", runtime: "claude-agent-sdk" })).toThrow("requires a model");
  });
});

describe("GovernancePolicyEngine", () => {
  test("allows tool when no policy exists", async () => {
    const db = createTestDb();
    const engine = new SqliteGovernancePolicyEngine(db);

    const result = await engine.preToolUse({
      issueId: "task-1", agentId: "agent-1",
      toolName: "Read", toolInput: {}, runtime: "cli",
    });
    expect(result.decision).toBe("allow");
  });

  test("denies tool in denied_tools", async () => {
    const db = createTestDb();
    db.query("INSERT INTO agents (name, type, command_template) VALUES ('test', 'custom', 'echo')").run();
    const agent = db.query("SELECT id FROM agents WHERE name = 'test'").get() as { id: string };
    db.query("INSERT INTO agent_policies (agent_id, denied_tools, approval_required_tools) VALUES (?, ?, '[]')")
      .run(agent.id, '["Bash"]');

    const engine = new SqliteGovernancePolicyEngine(db);
    const result = await engine.preToolUse({
      issueId: "task-1", agentId: agent.id,
      toolName: "Bash", toolInput: {}, runtime: "claude-agent-sdk",
    });
    expect(result.decision).toBe("deny");
  });

  test("requires approval for approval_required tools", async () => {
    const db = createTestDb();
    db.query("INSERT INTO agents (name, type, command_template) VALUES ('test', 'custom', 'echo')").run();
    const agent = db.query("SELECT id FROM agents WHERE name = 'test'").get() as { id: string };
    db.query("INSERT INTO agent_policies (agent_id, denied_tools, approval_required_tools) VALUES (?, '[]', ?)")
      .run(agent.id, '["Write"]');

    const engine = new SqliteGovernancePolicyEngine(db);
    const result = await engine.preToolUse({
      issueId: "task-1", agentId: agent.id,
      toolName: "Write", toolInput: {}, runtime: "claude-agent-sdk",
    });
    expect(result.decision).toBe("require_approval");
    expect(result.approvalRequestId).toBeDefined();
  });
});

describe("RuntimeDependencies (session persistence)", () => {
  test("save and load session", async () => {
    const db = createTestDb();
    const deps = createRuntimeDependencies(db);

    await deps.sessions.save({
      issueId: "issue-1",
      agentId: "agent-1",
      runtime: "claude-agent-sdk",
      providerSessionId: "session-123",
      stateBlob: '{"key":"value"}',
      lastEventSeq: 5,
      updatedAt: "2026-03-27T10:00:00Z",
    });

    const loaded = await deps.sessions.load("issue-1", "agent-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.runtime).toBe("claude-agent-sdk");
    expect(loaded!.providerSessionId).toBe("session-123");
    expect(loaded!.stateBlob).toBe('{"key":"value"}');
    expect(loaded!.lastEventSeq).toBe(5);
  });

  test("clear session", async () => {
    const db = createTestDb();
    const deps = createRuntimeDependencies(db);

    await deps.sessions.save({
      issueId: "issue-1", agentId: "agent-1", runtime: "claude-agent-sdk",
      providerSessionId: "s1", stateBlob: "{}", lastEventSeq: 0,
      updatedAt: "2026-03-27T10:00:00Z",
    });

    await deps.sessions.clear("issue-1", "agent-1");
    const loaded = await deps.sessions.load("issue-1", "agent-1");
    expect(loaded).toBeNull();
  });

  test("budget check with no limit allows", async () => {
    const db = createTestDb();
    const deps = createRuntimeDependencies(db);

    const canStart = await deps.budgets.canStart("nonexistent-agent");
    expect(canStart).toBe(true);
  });
});

describe("Migration v9", () => {
  test("creates sdk_sessions table and agent runtime columns", () => {
    const db = createTestDb();

    // Verify sdk_sessions table exists
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sdk_sessions'").get();
    expect(tables).not.toBeNull();

    // Verify new agent columns
    const columns = db.query("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
    const colNames = columns.map(c => c.name);
    expect(colNames).toContain("runtime");
    expect(colNames).toContain("model");
    expect(colNames).toContain("tools_json");
    expect(colNames).toContain("disallowed_tools_json");
    expect(colNames).toContain("approval_required_json");
    expect(colNames).toContain("max_budget_usd");
    expect(colNames).toContain("resume_enabled");
  });

  test("default runtime is cli", () => {
    const db = createTestDb();
    db.query("INSERT INTO agents (name, type, command_template) VALUES ('test', 'custom', 'echo hi')").run();
    const agent = db.query("SELECT runtime FROM agents WHERE name = 'test'").get() as { runtime: string };
    expect(agent.runtime).toBe("cli");
  });
});

describe("bootstrapRuntimeRegistry", () => {
  test("always registers CLI runtime", () => {
    const db = createTestDb();
    const registry = bootstrapRuntimeRegistry(db);
    expect(registry.has("cli")).toBe(true);
    expect(registry.list()).toContain("cli");
  });
});
