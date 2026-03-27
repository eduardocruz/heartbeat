/**
 * Phase 4 — Runtime abstraction layer
 *
 * Defines the AgentRuntime interface and RuntimeRegistry that allows
 * multiple execution backends (CLI, Claude Agent SDK, OpenAI Agents SDK)
 * to coexist behind a single dispatch surface.
 */

import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type RuntimeKind = "cli" | "claude-agent-sdk" | "openai-agent-sdk";

export interface RuntimeDispatchInput {
  taskId: string;
  agentId: string;
  prompt: string;
  workspacePath: string;
  timeoutSec: number;
}

export interface RuntimeDispatchResult {
  status: "done" | "failed" | "blocked";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  commitHash: string | null;
  usage?: RuntimeUsage;
  traceId?: string;
}

export interface RuntimeUsage {
  provider: "anthropic" | "openai" | "cli";
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export type ToolDecision = "allow" | "deny" | "require_approval";

export interface GovernancePolicyContext {
  issueId: string;
  agentId: string;
  toolName: string;
  toolInput: unknown;
  runtime: RuntimeKind;
}

export interface GovernancePolicyEngine {
  preToolUse(ctx: GovernancePolicyContext): Promise<{
    decision: ToolDecision;
    reason?: string;
    approvalRequestId?: string;
  }>;
  postToolUse(ctx: GovernancePolicyContext & { output: unknown; success: boolean }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Run events
// ---------------------------------------------------------------------------

export interface RunEvent {
  runId: string;
  issueId: string;
  seq: number;
  at: string;
  kind:
    | "run.started"
    | "message.delta"
    | "tool.pre"
    | "tool.post"
    | "approval.pending"
    | "approval.resolved"
    | "usage.delta"
    | "run.finished";
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

export interface PersistedSdkSession {
  issueId: string;
  agentId: string;
  runtime: Exclude<RuntimeKind, "cli">;
  providerSessionId: string;
  stateBlob: string;
  lastEventSeq: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Runtime dependencies
// ---------------------------------------------------------------------------

export interface RuntimeDependencies {
  governance: GovernancePolicyEngine;
  runEvents: {
    append(event: Omit<RunEvent, "seq">): Promise<number>;
  };
  sessions: {
    load(issueId: string, agentId: string): Promise<PersistedSdkSession | null>;
    save(session: PersistedSdkSession): Promise<void>;
    clear(issueId: string, agentId: string): Promise<void>;
  };
  budgets: {
    canStart(agentId: string, maxBudgetUsd?: number): Promise<boolean>;
    record(usage: RuntimeUsage & { runId: string; issueId: string; agentId: string }): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Agent runtime config
// ---------------------------------------------------------------------------

export interface AgentRuntimeConfig {
  id: string;
  name: string;
  runtime: RuntimeKind;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  approvalRequired?: string[];
  maxBudgetUsd?: number;
  resume?: boolean;
  heartbeatCron?: string;
  commandTemplate?: string; // Tier 1 CLI only
  soulMd?: string | null;
}

// ---------------------------------------------------------------------------
// AgentRuntime interface
// ---------------------------------------------------------------------------

export interface AgentRuntime {
  kind: RuntimeKind;
  canResume(): boolean;
  validate(config: AgentRuntimeConfig): void;
  run(input: RuntimeDispatchInput, deps: RuntimeDependencies): Promise<RuntimeDispatchResult>;
}

// ---------------------------------------------------------------------------
// Runtime Registry
// ---------------------------------------------------------------------------

export class RuntimeRegistry {
  private runtimes = new Map<RuntimeKind, AgentRuntime>();

  register(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.kind, runtime);
  }

  get(kind: RuntimeKind): AgentRuntime | undefined {
    return this.runtimes.get(kind);
  }

  has(kind: RuntimeKind): boolean {
    return this.runtimes.has(kind);
  }

  list(): RuntimeKind[] {
    return Array.from(this.runtimes.keys());
  }

  resolve(config: AgentRuntimeConfig): AgentRuntime {
    const runtime = this.runtimes.get(config.runtime);
    if (!runtime) {
      throw new Error(`No runtime registered for kind "${config.runtime}". Available: ${this.list().join(", ")}`);
    }
    runtime.validate(config);
    return runtime;
  }
}

// ---------------------------------------------------------------------------
// Config validation helpers
// ---------------------------------------------------------------------------

export function validateRuntimeConfig(config: AgentRuntimeConfig): string[] {
  const errors: string[] = [];

  if (config.runtime === "cli") {
    if (!config.commandTemplate?.trim()) {
      errors.push("CLI runtime requires a non-empty commandTemplate");
    }
  } else {
    if (!config.model?.trim()) {
      errors.push(`SDK runtime "${config.runtime}" requires a model`);
    }
  }

  if (config.tools && config.disallowedTools) {
    const overlap = config.tools.filter((t) => config.disallowedTools!.includes(t));
    if (overlap.length > 0) {
      errors.push(`Tools cannot appear in both tools and disallowedTools: ${overlap.join(", ")}`);
    }
  }

  if (config.approvalRequired && config.tools) {
    const notAllowed = config.approvalRequired.filter((t) => !config.tools!.includes(t));
    if (notAllowed.length > 0) {
      errors.push(`approvalRequired tools must be in allowed tools list: ${notAllowed.join(", ")}`);
    }
  }

  if (config.approvalRequired && config.disallowedTools) {
    const denied = config.approvalRequired.filter((t) => config.disallowedTools!.includes(t));
    if (denied.length > 0) {
      errors.push(`approvalRequired tools cannot be in disallowedTools: ${denied.join(", ")}`);
    }
  }

  return errors;
}
