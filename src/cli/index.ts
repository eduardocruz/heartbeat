#!/usr/bin/env bun
import { closeSync, openSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Command } from "commander";
import { startServer } from "../server";
import {
  DEFAULT_PORT,
  getDefaultConfigPath,
  getDefaultDbPath,
  getDefaultLogPath,
  getDefaultStatePath,
  HEARTBEAT_VERSION,
} from "./constants";
import {
  ensureParentDir,
  isPidRunning,
  readDaemonState,
  removeDaemonState,
  writeDaemonState,
} from "./state";
import { commandUpdate } from "./update";

type ExecutorStatus = {
  startedAt?: string;
  uptimeSeconds?: number;
  runningTasks?: number;
  queueLength?: number;
  lastPollAt?: string | null;
  agentHeartbeats?: number;
};

type TaskLog = {
  title: string;
  status: string;
  agent: string | null;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
};

type AssignedIssue = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
};

type AgentDetails = {
  id: string;
  name: string;
  type: string;
  command_template: string;
  active: number;
  heartbeat_cron: string | null;
  heartbeat_prompt: string | null;
  heartbeat_repo: string | null;
  heartbeat_enabled: number;
  heartbeat_next_run: string | null;
  created_at: string;
  assigned_issues: AssignedIssue[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function parsePort(port: string): number {
  const parsed = Number.parseInt(port, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("--port must be a valid TCP port");
  }

  return parsed;
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

function getRuntimeInvocation(): string[] {
  const currentArgv = process.argv.slice(1);
  const firstArg = currentArgv[0];

  if (firstArg && /\.(c|m)?tsx?$/.test(firstArg)) {
    return [process.execPath, firstArg];
  }

  return [process.execPath];
}

const SAMPLE_CONFIG = `agents:
  - id: claude-main
    name: Claude Main
    type: claude
    command_template: 'claude -p "{prompt}" --output-format json'
    heartbeat_enabled: true
  - id: codex-main
    name: Codex Main
    type: codex
    command_template: 'codex --prompt "{prompt}" --auto-edit'
    heartbeat_enabled: false
`;

async function commandInit(): Promise<void> {
  const configPath = resolve(getDefaultConfigPath());

  writeFileSync(configPath, SAMPLE_CONFIG, "utf8");

  console.log(`Created: ${configPath}`);
  console.log("Next steps:");
  console.log("  1) heartbeat start");
  console.log("  2) heartbeat status");
  console.log("  3) heartbeat stop");
}

async function commandRunDaemon(options: { port: string; db: string; state: string; log: string }): Promise<void> {
  const port = parsePort(options.port);
  const dbPath = resolve(options.db);
  const statePath = resolve(options.state);
  const logPath = resolve(options.log);

  ensureParentDir(statePath);
  ensureParentDir(logPath);

  const server = startServer({
    port,
    dbPath,
  });

  const cleanup = () => {
    removeDaemonState(statePath);
    server.stop();
    process.exit(0);
  };

  writeDaemonState(statePath, {
    pid: process.pid,
    port,
    dbPath,
    logPath,
    startedAt: server.startedAt,
  });

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function commandStart(options: { port: string; db: string; state: string; log: string }): Promise<void> {
  const port = parsePort(options.port);
  const dbPath = resolve(options.db);
  const statePath = resolve(options.state);
  const logPath = resolve(options.log);
  const existing = readDaemonState(statePath);

  if (existing && isPidRunning(existing.pid)) {
    console.log(`HeartBeat is already running (pid ${existing.pid})`);
    console.log(`Status: http://127.0.0.1:${existing.port}/api/executor/status`);
    return;
  }

  removeDaemonState(statePath);
  ensureParentDir(logPath);

  const [command, ...baseArgs] = getRuntimeInvocation();
  const output = openSync(logPath, "a");
  const child = spawn(
    command,
    [...baseArgs, "__run-daemon", "--port", String(port), "--db", dbPath, "--state", statePath, "--log", logPath],
    {
      detached: true,
      stdio: ["ignore", output, output],
      env: process.env,
    },
  );

  closeSync(output);
  child.unref();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = readDaemonState(statePath);
    if (state && isPidRunning(state.pid)) {
      console.log(`HeartBeat started in background (pid ${state.pid})`);
      console.log(`URL: http://127.0.0.1:${state.port}`);
      console.log(`DB: ${state.dbPath}`);
      console.log(`Log: ${state.logPath}`);
      return;
    }

    await sleep(100);
  }

  throw new Error(`Daemon failed to start. Check ${logPath}`);
}


async function commandRestart(options: { port: string; db: string; state: string; log: string }): Promise<void> {
  await commandStop({ state: options.state });
  await commandStart(options);
}

async function commandStatus(options: { state: string }): Promise<void> {
  const statePath = resolve(options.state);
  const state = readDaemonState(statePath);

  if (!state || !isPidRunning(state.pid)) {
    removeDaemonState(statePath);
    console.log("HeartBeat is not running");
    return;
  }

  const status = await fetchJson<ExecutorStatus>(`http://127.0.0.1:${state.port}/api/executor/status`);
  const rows = [
    ["PID", String(state.pid)],
    ["URL", `http://127.0.0.1:${state.port}`],
    ["Port", String(state.port)],
    ["Server started", status.startedAt ?? state.startedAt],
    ["Uptime", typeof status.uptimeSeconds === "number" ? `${status.uptimeSeconds}s` : "-"],
    ["Active tasks", String(status.runningTasks ?? 0)],
    ["Queue length", String(status.queueLength ?? 0)],
    ["Agent heartbeats", String(status.agentHeartbeats ?? 0)],
    ["Last poll", status.lastPollAt ?? "-"],
    ["DB path", state.dbPath],
    ["Log path", state.logPath],
  ];

  console.log(renderTable(["Metric", "Value"], rows));
}

async function commandStop(options: { state: string }): Promise<void> {
  const statePath = resolve(options.state);
  const state = readDaemonState(statePath);

  if (!state || !isPidRunning(state.pid)) {
    removeDaemonState(statePath);
    console.log("HeartBeat is not running");
    return;
  }

  process.kill(state.pid, "SIGTERM");

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isPidRunning(state.pid)) {
      removeDaemonState(statePath);
      console.log(`HeartBeat stopped (pid ${state.pid})`);
      return;
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for HeartBeat to stop (pid ${state.pid})`);
}

async function commandLogs(agent: string | undefined, options: { state: string; limit: string }): Promise<void> {
  const statePath = resolve(options.state);
  const state = readDaemonState(statePath);

  if (!state || !isPidRunning(state.pid)) {
    removeDaemonState(statePath);
    throw new Error("HeartBeat is not running");
  }

  const limit = Number.parseInt(options.limit, 10);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (agent && agent.trim().length > 0) {
    params.set("agent", agent.trim());
  }

  const tasks = await fetchJson<TaskLog[]>(`http://127.0.0.1:${state.port}/api/tasks?${params.toString()}`);
  const rows = tasks.map((task) => [
    task.title,
    task.status,
    task.agent ?? "-",
    formatDurationSeconds(task.started_at, task.completed_at),
    task.exit_code === null ? "-" : String(task.exit_code),
  ]);

  console.log(renderTable(["Task", "Status", "Agent", "Duration", "Exit"], rows));
}

async function commandAgentsShow(agent: string, options: { state: string }): Promise<void> {
  const statePath = resolve(options.state);
  const state = readDaemonState(statePath);

  if (!state || !isPidRunning(state.pid)) {
    removeDaemonState(statePath);
    throw new Error("HeartBeat is not running");
  }

  const details = await fetchJson<AgentDetails>(`http://127.0.0.1:${state.port}/api/agents/${encodeURIComponent(agent)}`);
  const rows = [
    ["ID", details.id],
    ["Name", details.name],
    ["Type", details.type],
    ["Active", details.active === 1 ? "yes" : "no"],
    ["Heartbeat enabled", details.heartbeat_enabled === 1 ? "yes" : "no"],
    ["Heartbeat cron", details.heartbeat_cron ?? "-"],
    ["Heartbeat next run", details.heartbeat_next_run ?? "-"],
    ["Heartbeat repo", details.heartbeat_repo ?? "-"],
    ["Created", details.created_at],
    ["Command template", details.command_template],
  ];

  console.log(renderTable(["Field", "Value"], rows));

  if (details.assigned_issues.length === 0) {
    console.log("\nAssigned issues: none");
    return;
  }

  const issueRows = details.assigned_issues.map((issue) => [
    issue.id,
    issue.title,
    issue.status,
    issue.priority ?? "-",
    issue.updated_at,
  ]);
  console.log("");
  console.log("Assigned issues");
  console.log(renderTable(["ID", "Title", "Status", "Priority", "Updated"], issueRows));
}

export async function runCli(argv = process.argv): Promise<void> {
  const defaultStatePath = getDefaultStatePath();
  const defaultLogPath = getDefaultLogPath();
  const defaultDbPath = getDefaultDbPath();

  ensureParentDir(defaultStatePath);
  ensureParentDir(defaultLogPath);
  ensureParentDir(defaultDbPath);

  const program = new Command();
  program.name("heartbeat").description("HeartBeat CLI").version(HEARTBEAT_VERSION);

  program.command("init").description("Scaffold heartbeat.yaml in the current directory").action(commandInit);

  program
    .command("start")
    .description("Start the HeartBeat daemon in the background")
    .option("--port <port>", "Server port", process.env.PORT ?? DEFAULT_PORT)
    .option("--db <path>", "SQLite database path", defaultDbPath)
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .option("--log <path>", "Daemon log file", defaultLogPath)
    .action(commandStart);

  program
    .command("status")
    .description("Show daemon status and executor metrics")
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .action(commandStatus);

  program
    .command("stop")
    .description("Stop the running HeartBeat daemon")
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .action(commandStop);

  program
    .command("restart")
    .description("Restart the HeartBeat daemon")
    .option("--port <port>", "Server port", process.env.PORT ?? DEFAULT_PORT)
    .option("--db <path>", "SQLite database path", defaultDbPath)
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .option("--log <path>", "Daemon log file", defaultLogPath)
    .action(commandRestart);

  program
    .command("logs")
    .description("Show recent task runs from the running daemon")
    .argument("[agent]", "Optional agent name filter")
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .option("--limit <n>", "Number of records", "20")
    .action(commandLogs);

  const agentsCommand = program.command("agents").description("Inspect and manage agents");
  agentsCommand.alias("agent");

  agentsCommand
    .command("show")
    .alias("details")
    .description("Show agent details and assigned issues")
    .argument("<agent>", "Agent id or name")
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .action(commandAgentsShow);

  program
    .command("update")
    .description("Update the installed HeartBeat CLI to the latest GitHub release")
    .action(() => commandUpdate(HEARTBEAT_VERSION));

  program
    .command("__run-daemon")
    .option("--port <port>", "Server port", process.env.PORT ?? DEFAULT_PORT)
    .option("--db <path>", "SQLite database path", defaultDbPath)
    .option("--state <path>", "Daemon state file", defaultStatePath)
    .option("--log <path>", "Daemon log file", defaultLogPath)
    .action(commandRunDaemon);

  await program.parseAsync(argv);
}

if (import.meta.main) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
