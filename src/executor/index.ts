import { Database } from "bun:sqlite";
import { setupWorkspace, getLatestCommit, cleanupOldWorkspaces } from "./git";
import { reconcileBlockedDependents } from "../tasks/dependencies";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  agent: string | null;
  repo_url: string | null;
  branch: string | null;
  timeout_seconds: number | null;
  status: string;
};

type AgentRow = {
  name: string;
  command_template: string;
  active: number;
  soul_md: string | null;
};

type ExecutorOptions = {
  maxConcurrent?: number;
  defaultTimeoutSec?: number;
};

type ExecutorStatus = {
  runningTasks: number;
  queueLength: number;
  lastPollAt: string | null;
};

export class Executor {
  private readonly db: Database;
  private readonly running = new Map<string, Bun.Subprocess<"ignore", "pipe", "pipe">>();
  private readonly maxConcurrent: number;
  private readonly defaultTimeoutSec: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;
  private lastPollAt: string | null = null;

  constructor(db: Database, options: ExecutorOptions = {}) {
    this.db = db;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.defaultTimeoutSec = options.defaultTimeoutSec ?? 600;
  }

  start(pollIntervalMs = 10_000): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.checkForWork();
    }, pollIntervalMs);

    void this.checkForWork();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): ExecutorStatus {
    const queue = this.db.query("SELECT COUNT(*) AS count FROM tasks WHERE status = 'todo'").get() as {
      count: number;
    };

    return {
      runningTasks: this.running.size,
      queueLength: queue.count,
      lastPollAt: this.lastPollAt,
    };
  }

  async checkForWork(): Promise<void> {
    if (this.isChecking) {
      return;
    }
    this.isChecking = true;
    this.lastPollAt = new Date().toISOString();

    try {
      while (this.running.size < this.maxConcurrent) {
        const task = this.getNextPendingTask();
        if (!task) {
          return;
        }
        await this.executeTask(task);
      }
    } finally {
      this.isChecking = false;
    }
  }

  private getNextPendingTask(): TaskRow | null {
    return this.db
      .query("SELECT * FROM tasks WHERE status = 'todo' AND agent IS NOT NULL ORDER BY created_at ASC LIMIT 1")
      .get() as TaskRow | null;
  }

  private createRun(taskId: string, agent: string, workspaceDir: string | null): string {
    const result = this.db
      .query(
        "INSERT INTO runs (task_id, agent, status, workspace_dir) VALUES (?, ?, 'running', ?)",
      )
      .run(taskId, agent, workspaceDir);
    const row = this.db.query("SELECT id FROM runs WHERE rowid = ?").get(result.lastInsertRowid) as { id: string };
    return row.id;
  }

  private completeRun(
    runId: string,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    timedOut: boolean,
    commitHash: string | null,
  ): void {
    const status = timedOut || exitCode !== 0 ? "failed" : "done";
    this.db
      .query(
        "UPDATE runs SET status = ?, exit_code = ?, stdout = ?, stderr = ?, commit_hash = ?, timed_out = ?, completed_at = datetime('now') WHERE id = ?",
      )
      .run(status, exitCode, stdout, stderr, commitHash, timedOut ? 1 : 0, runId);
  }

  private failRun(runId: string, message: string): void {
    this.db
      .query(
        "UPDATE runs SET status = 'failed', stderr = ?, completed_at = datetime('now') WHERE id = ?",
      )
      .run(message, runId);
  }

  private updateTaskStart(taskId: string): void {
    this.db
      .query(
        "UPDATE tasks SET status = 'in_progress', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run(taskId);
  }

  private completeTask(
    taskId: string,
    previousStatus: string,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    timedOut: boolean,
    timeoutSec: number,
    commitHash: string | null,
  ): void {
    const status = timedOut || exitCode !== 0 ? "failed" : "done";
    const finalStderr = timedOut
      ? `${stderr}${stderr.length > 0 ? "\n" : ""}timeout after ${timeoutSec}s`
      : stderr;

    this.db
      .query(
        "UPDATE tasks SET status = ?, exit_code = ?, stdout = ?, stderr = ?, commit_hash = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run(status, exitCode, stdout, finalStderr, commitHash, taskId);
    reconcileBlockedDependents(this.db, taskId, previousStatus, status);
  }

  private failTask(taskId: string, previousStatus: string, message: string): void {
    this.db
      .query(
        "UPDATE tasks SET status = 'failed', stderr = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run(message, taskId);
    reconcileBlockedDependents(this.db, taskId, previousStatus, "failed");
  }

  async executeTask(task: TaskRow): Promise<void> {
    this.updateTaskStart(task.id);

    if (!task.agent) {
      this.failTask(task.id, "in_progress", "unknown agent: null");
      return;
    }

    const agent = this.db
      .query("SELECT name, command_template, active, soul_md FROM agents WHERE name = ? LIMIT 1")
      .get(task.agent) as AgentRow | null;
    if (!agent || agent.active !== 1) {
      this.failTask(task.id, "in_progress", `unknown agent: ${task.agent}`);
      return;
    }

    if (!agent.command_template.trim()) {
      this.failTask(task.id, "in_progress", `empty command template for agent: ${task.agent}`);
      return;
    }

    const { command, prompt } = this.buildCommandWithPrompt(agent.command_template, task, agent.soul_md);
    let workdir = "/tmp";
    if (task.repo_url) {
      try {
        workdir = await setupWorkspace(task.repo_url, task.id, task.branch ?? "main");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failTask(task.id, "in_progress", `workspace setup failed: ${message}`);
        return;
      }
    }

    cleanupOldWorkspaces();

    const runId = this.createRun(task.id, task.agent, workdir !== "/tmp" ? workdir : null);

    // For claude --print, pass prompt via stdin to avoid shell quoting issues
    const isClaudeCommand = command.trimStart().startsWith("claude");
    const stdinContent = isClaudeCommand ? prompt : null;
    const finalCommand = isClaudeCommand ? command : command;

    const proc = Bun.spawn(["sh", "-lc", finalCommand], {
      cwd: workdir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: stdinContent ? new TextEncoder().encode(stdinContent) : "ignore",
    });

    this.running.set(task.id, proc);

    let timedOut = false;
    const timeoutSec = task.timeout_seconds ?? this.defaultTimeoutSec;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutSec * 1000);

    try {
      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();
      const exitedPromise = proc.exited;
      const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, exitedPromise]);
      let commitHash: string | null = null;
      if (!timedOut && exitCode === 0 && task.repo_url) {
        commitHash = await getLatestCommit(workdir);
      }
      this.completeRun(runId, exitCode, stdout, stderr, timedOut, commitHash);
      this.completeTask(task.id, "in_progress", exitCode, stdout, stderr, timedOut, timeoutSec, commitHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failRun(runId, message);
      this.failTask(task.id, "in_progress", message);
    } finally {
      clearTimeout(timeout);
      this.running.delete(task.id);
    }
  }

  buildCommand(template: string, task: TaskRow, soulMd?: string | null): string {
    return this.buildCommandWithPrompt(template, task, soulMd).command;
  }

  buildCommandWithPrompt(template: string, task: TaskRow, soulMd?: string | null): { command: string; prompt: string } {
    const taskContent = `${task.title}${task.description ? `\n${task.description}` : ""}`;
    const prompt = soulMd
      ? `You are an AI agent with the following identity and values:\n\n${soulMd}\n\n---\n\nTask: ${taskContent}`
      : taskContent;
    const command = template
      .replaceAll("{prompt}", prompt)
      .replaceAll("{repo}", task.repo_url ?? "")
      .replaceAll("{branch}", task.branch ?? "main");
    return { command, prompt };
  }
}
