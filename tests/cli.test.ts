import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
import * as yaml from "js-yaml";
import { HEARTBEAT_VERSION } from "../src/cli/constants";
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
  test("export command includes current heartbeat version", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
    });
    const serverPort = server.port;
    if (serverPort === undefined) {
      throw new Error("Test server did not expose a port");
    }

    const tempDir = mkdtempSync(join(tmpdir(), "heartbeat-export-"));
    cleanupPaths.push(tempDir);
    const statePath = join(tempDir, "daemon.json");
    const logPath = join(tempDir, "heartbeat.log");
    const dbPath = join(tempDir, "heartbeat.db");
    const outputPath = join(tempDir, "export.yaml");
    writeFileSync(logPath, "", "utf8");
    writeDaemonState(statePath, {
      pid: process.pid,
      port: serverPort,
      dbPath,
      logPath,
      startedAt: new Date().toISOString(),
    });

    try {
      await runCli(["bun", "heartbeat", "export", outputPath, "--state", statePath]);
      const exportRaw = readFileSync(outputPath, "utf8");
      const parsed = yaml.load(exportRaw) as { version?: string };
      expect(parsed.version).toBe(HEARTBEAT_VERSION);
    } finally {
      server.stop(true);
      db.close();
    }
  });

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

  test("compiled binary serves /app/main.js", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "heartbeat-compiled-"));
    cleanupPaths.push(tempDir);
    const binPath = join(tempDir, "heartbeat-smoke");
    const dbPath = join(tempDir, "heartbeat-smoke.db");
    const statePath = join(tempDir, "heartbeat-smoke.state");
    const logPath = join(tempDir, "heartbeat-smoke.log");
    const port = 41000 + Math.floor(Math.random() * 1000);

    const compile = spawnSync(
      "bun",
      ["build", "--compile", "--target=bun-linux-x64", "src/cli/index.ts", "--outfile", binPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(compile.status).toBe(0);

    let started = false;
    try {
      const start = spawnSync(
        binPath,
        ["start", "--port", String(port), "--db", dbPath, "--state", statePath, "--log", logPath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(start.status).toBe(0);
      started = true;

      let ready = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          const status = await fetch(`http://127.0.0.1:${port}/api/executor/status`);
          if (status.ok) {
            ready = true;
            break;
          }
        } catch {}

        await Bun.sleep(100);
      }

      expect(ready).toBe(true);

      const appMainResponse = await fetch(`http://127.0.0.1:${port}/app/main.js`);
      expect(appMainResponse.status).toBe(200);
    } finally {
      if (started) {
        spawnSync(binPath, ["stop", "--state", statePath], { cwd: process.cwd(), encoding: "utf8" });
      }
    }
  });
});
