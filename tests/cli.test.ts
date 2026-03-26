import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db";
import { runCli } from "../src/cli";
import { writeDaemonState } from "../src/cli/state";
import { createApp } from "../src/server/app";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("cli", () => {
  test("shows agent details and assigned issues", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createAgentResp = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "codex",
        type: "custom",
        command_template: "echo hello",
      }),
    });
    expect(createAgentResp.status).toBe(201);
    const agent = (await createAgentResp.json()) as { id: string };

    const createTaskResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Investigate bug",
        agent: "codex",
        status: "in_progress",
      }),
    });
    expect(createTaskResp.status).toBe(201);

    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
    });
    const serverPort = server.port;
    if (serverPort === undefined) {
      throw new Error("Test server did not expose a port");
    }

    const tempDir = mkdtempSync(join(tmpdir(), "heartbeat-cli-"));
    cleanupPaths.push(tempDir);
    const statePath = join(tempDir, "daemon.json");
    const logPath = join(tempDir, "heartbeat.log");
    const dbPath = join(tempDir, "heartbeat.db");
    writeFileSync(logPath, "", "utf8");
    writeDaemonState(statePath, {
      pid: process.pid,
      port: serverPort,
      dbPath,
      logPath,
      startedAt: new Date().toISOString(),
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runCli(["bun", "heartbeat", "agents", "show", agent.id, "--state", statePath]);
    } finally {
      console.log = originalLog;
      server.stop(true);
      db.close();
    }

    const output = logs.join("\n");
    expect(output).toContain("codex");
    expect(output).toContain("Investigate bug");
    expect(output).toContain("in_progress");
  });
});
