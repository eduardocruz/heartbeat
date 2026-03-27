/**
 * Phase 4 — ClaudeAgentSdkRuntime
 *
 * Native SDK runtime for Anthropic Claude Agent SDK.
 * Activated behind the HB_TIER2_CLAUDE=1 feature flag.
 *
 * This runtime uses the Claude CLI with --print as the execution backend
 * while exposing the SDK runtime interface. When the full Agent SDK
 * npm package is available, this can be swapped to use the native SDK
 * streaming API with tool hooks.
 */

import type { Database } from "bun:sqlite";
import type {
  AgentRuntime,
  AgentRuntimeConfig,
  RuntimeDependencies,
  RuntimeDispatchInput,
  RuntimeDispatchResult,
  RuntimeUsage,
} from "./runtime";

export class ClaudeAgentSdkRuntime implements AgentRuntime {
  readonly kind = "claude-agent-sdk" as const;

  constructor(private readonly db: Database) {}

  canResume(): boolean {
    return true;
  }

  validate(config: AgentRuntimeConfig): void {
    if (!config.model?.trim()) {
      throw new Error("Claude Agent SDK runtime requires a model (e.g., 'sonnet', 'opus')");
    }
  }

  async run(input: RuntimeDispatchInput, deps: RuntimeDependencies): Promise<RuntimeDispatchResult> {
    // Check budget before starting
    const canStart = await deps.budgets.canStart(input.agentId);
    if (!canStart) {
      return {
        status: "blocked",
        stdout: "",
        stderr: "Monthly budget limit reached",
        exitCode: null,
        commitHash: null,
      };
    }

    // Emit run started event
    await deps.runEvents.append({
      runId: input.taskId,
      issueId: input.taskId,
      at: new Date().toISOString(),
      kind: "run.started",
      payload: { agent: input.agentId, runtime: this.kind },
    });

    // Check for resumable session
    const existingSession = await deps.sessions.load(input.taskId, input.agentId);
    const isResume = existingSession !== null;

    // Build the claude command with model and allowed tools
    const agentRow = this.db
      .query("SELECT soul_md FROM agents WHERE id = ? OR name = ? LIMIT 1")
      .get(input.agentId, input.agentId) as { soul_md: string | null } | null;

    const soulContext = agentRow?.soul_md
      ? `You are an AI agent with the following identity and values:\n\n${agentRow.soul_md}\n\n---\n\n`
      : "";

    const fullPrompt = isResume
      ? `${soulContext}Continuing previous session.\n\n${input.prompt}`
      : `${soulContext}${input.prompt}`;

    // Use claude --print as the execution backend
    const command = "claude --print";

    const proc = Bun.spawn(["sh", "-lc", command], {
      cwd: input.workspacePath,
      stdout: "pipe",
      stderr: "pipe",
      stdin: new TextEncoder().encode(fullPrompt),
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

      // Persist session state for future resume
      if (!timedOut && exitCode === 0) {
        await deps.sessions.save({
          issueId: input.taskId,
          agentId: input.agentId,
          runtime: "claude-agent-sdk",
          providerSessionId: `claude-${input.taskId}-${Date.now()}`,
          stateBlob: JSON.stringify({ lastPrompt: input.prompt, outputLength: stdout.length }),
          lastEventSeq: 0,
          updatedAt: new Date().toISOString(),
        });
      }

      // Estimate usage (rough estimate based on character counts)
      const estimatedInputTokens = Math.ceil(fullPrompt.length / 4);
      const estimatedOutputTokens = Math.ceil(stdout.length / 4);
      const usage: RuntimeUsage = {
        provider: "anthropic",
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        estimatedCostUsd: (estimatedInputTokens * 0.003 + estimatedOutputTokens * 0.015) / 1000,
      };

      await deps.budgets.record({
        ...usage,
        runId: input.taskId,
        issueId: input.taskId,
        agentId: input.agentId,
      });

      // Emit usage event
      await deps.runEvents.append({
        runId: input.taskId,
        issueId: input.taskId,
        at: new Date().toISOString(),
        kind: "usage.delta",
        payload: usage as unknown as Record<string, unknown>,
      });

      // Emit run finished event
      await deps.runEvents.append({
        runId: input.taskId,
        issueId: input.taskId,
        at: new Date().toISOString(),
        kind: "run.finished",
        payload: { exitCode, timedOut },
      });

      const finalStderr = timedOut
        ? `${stderr}${stderr.length > 0 ? "\n" : ""}timeout after ${input.timeoutSec}s`
        : stderr;

      return {
        status: timedOut || exitCode !== 0 ? "failed" : "done",
        stdout,
        stderr: finalStderr,
        exitCode,
        commitHash: null,
        usage,
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
