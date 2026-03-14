#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { startServer } from "./server";

type ExecutorStatus = {
  startedAt?: string;
  uptimeSeconds?: number;
  runningTasks?: number;
  queueLength?: number;
  lastPollAt?: string | null;
  agentHeartbeats?: number;
};

type TaskLog = {
  id: string;
  title: string;
  status: string;
  agent: string | null;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
};

function defaultDbPath(): string {
  return process.env.HEARTBEAT_DB_PATH ?? join(process.env.HOME ?? homedir(), ".heartbeat", "heartbeat.db");
}

function formatDurationSeconds(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) {
    return "-";
  }

  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) {
    return "-";
  }

  const endMs = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(endMs)) {
    return "-";
  }

  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  return `${seconds}s`;
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index], " ")).join("  ");

  const separator = widths.map((width) => "-".repeat(width)).join("  ");

  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as T;
}

async function commandStart(options: { port: string; db: string }): Promise<void> {
  const port = Number.parseInt(options.port, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be a valid TCP port");
  }

  const dbPath = resolve(options.db);
  const server = startServer({
    port,
    dbPath,
  });

  console.log(`DB: ${dbPath}`);
  console.log(`Started at: ${server.startedAt}`);

  const shutdown = () => {
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function commandStatus(options: { port: string }): Promise<void> {
  const port = Number.parseInt(options.port, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be a valid TCP port");
  }

  const status = await fetchJson<ExecutorStatus>(`http://localhost:${port}/api/executor/status`);

  const rows = [
    ["Server started", status.startedAt ?? "-"],
    ["Uptime", typeof status.uptimeSeconds === "number" ? `${status.uptimeSeconds}s` : "-"],
    ["Active tasks", String(status.runningTasks ?? 0)],
    ["Queue length", String(status.queueLength ?? 0)],
    ["Agent heartbeats", String(status.agentHeartbeats ?? 0)],
    ["Last poll", status.lastPollAt ?? "-"],
  ];

  console.log(renderTable(["Metric", "Value"], rows));
}

async function commandInit(): Promise<void> {
  const heartbeatDir = join(process.env.HOME ?? homedir(), ".heartbeat");
  const dbPath = join(heartbeatDir, "heartbeat.db");
  mkdirSync(heartbeatDir, { recursive: true });

  const configPath = resolve(process.cwd(), "heartbeat.yaml");
  const sample = {
    agents: [
      {
        id: "claude-main",
        name: "Claude Main",
        type: "claude",
        command_template: 'claude -p "{prompt}" --output-format json',
        heartbeat_enabled: true,
      },
      {
        id: "codex-main",
        name: "Codex Main",
        type: "codex",
        command_template: 'codex --prompt "{prompt}" --auto-edit',
        heartbeat_enabled: false,
      },
    ],
  };

  writeFileSync(configPath, yaml.dump(sample), "utf8");

  // Ensure parent directory exists when a custom db path is exported later.
  mkdirSync(dirname(dbPath), { recursive: true });

  console.log(`Created: ${heartbeatDir}`);
  console.log(`Created: ${configPath}`);
  console.log("Next steps:");
  console.log("  1) bun run src/index.ts start");
  console.log("  2) bun run src/index.ts status");
  console.log("  3) bun run src/index.ts logs");
}

async function commandLogs(agent: string | undefined, options: { port: string; limit: string }): Promise<void> {
  const port = Number.parseInt(options.port, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be a valid TCP port");
  }

  const limit = Number.parseInt(options.limit, 10);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (agent && agent.trim().length > 0) {
    params.set("agent", agent.trim());
  }

  const tasks = await fetchJson<TaskLog[]>(`http://localhost:${port}/api/tasks?${params.toString()}`);
  const rows = tasks.map((task) => [
    task.title,
    task.status,
    task.agent ?? "-",
    formatDurationSeconds(task.started_at, task.completed_at),
    task.exit_code === null ? "-" : String(task.exit_code),
  ]);

  console.log(renderTable(["Task", "Status", "Agent", "Duration", "Exit"], rows));
}

const program = new Command();
program
  .name("heartbeat")
  .description("HeartBeat CLI")
  .version("0.1.0");

program
  .command("start")
  .description("Start HTTP server, executor, and scheduler")
  .option("--port <port>", "Server port", process.env.PORT ?? "4400")
  .option("--db <path>", "SQLite database path", defaultDbPath())
  .action((options) => {
    void commandStart(options);
  });

program
  .command("status")
  .description("Show runtime status from a running server")
  .option("--port <port>", "Server port", process.env.PORT ?? "4400")
  .action((options) => {
    void commandStatus(options);
  });

program.command("init").description("Create ~/.heartbeat and sample heartbeat.yaml").action(() => {
  void commandInit();
});

program
  .command("logs")
  .description("Show recent task runs")
  .argument("[agent]", "Optional agent name filter")
  .option("--port <port>", "Server port", process.env.PORT ?? "4400")
  .option("--limit <n>", "Number of records", "20")
  .action((agent, options) => {
    void commandLogs(agent, options);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
