/**
 * Phase 4 — CliRuntime
 *
 * Wraps the existing CLI executor logic as an AgentRuntime implementation.
 * This is the baseline runtime that preserves all Tier 1 behavior.
 */

import type { Database } from "bun:sqlite";
import type {
  AgentRuntime,
  AgentRuntimeConfig,
  RuntimeDependencies,
  RuntimeDispatchInput,
  RuntimeDispatchResult,
} from "./runtime";
import { getLatestCommit } from "./git";

export class CliRuntime implements AgentRuntime {
  readonly kind = "cli" as const;

  constructor(private readonly db: Database) {}

  canResume(): boolean {
    return false;
  }

  validate(config: AgentRuntimeConfig): void {
    if (!config.commandTemplate?.trim()) {
      throw new Error("CLI runtime requires a non-empty commandTemplate");
    }
  }

  async run(input: RuntimeDispatchInput, deps: RuntimeDependencies): Promise<RuntimeDispatchResult> {
    // Look up agent config for command template and soul
    const agentRow = this.db
      .query("SELECT command_template, soul_md FROM agents WHERE id = ? OR name = ? LIMIT 1")
      .get(input.agentId, input.agentId) as { command_template: string; soul_md: string | null } | null;

    if (!agentRow) {
      return {
        status: "failed",
        stdout: "",
        stderr: `Agent not found: ${input.agentId}`,
        exitCode: 1,
        commitHash: null,
      };
    }

    const command = agentRow.command_template
      .replaceAll("{prompt}", input.prompt)
      .replaceAll("{repo}", "")
      .replaceAll("{branch}", "main");

    const isClaudeCommand = command.trimStart().startsWith("claude");
    const stdinContent = isClaudeCommand ? input.prompt : null;

    const proc = Bun.spawn(["sh", "-lc", command], {
      cwd: input.workspacePath,
      stdout: "pipe",
      stderr: "pipe",
      stdin: stdinContent ? new TextEncoder().encode(stdinContent) : "ignore",
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, input.timeoutSec * 1000);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      clearTimeout(timeout);

      let commitHash: string | null = null;
      if (!timedOut && exitCode === 0 && input.workspacePath !== "/tmp") {
        try {
          commitHash = await getLatestCommit(input.workspacePath);
        } catch {
          // workspace may not be a git repo
        }
      }

      const finalStderr = timedOut
        ? `${stderr}${stderr.length > 0 ? "\n" : ""}timeout after ${input.timeoutSec}s`
        : stderr;

      return {
        status: timedOut || exitCode !== 0 ? "failed" : "done",
        stdout,
        stderr: finalStderr,
        exitCode,
        commitHash,
      };
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "failed",
        stdout: "",
        stderr: message,
        exitCode: null,
        commitHash: null,
      };
    }
  }
}
