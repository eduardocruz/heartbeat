import type { TaskStatus } from "../tasks/workflow";
import type { RuntimeKind } from "../executor/runtime";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  agent: string;
  reviewer?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  type: "claude" | "codex" | "custom";
  commandTemplate: string;
  heartbeatCron?: string;
  heartbeatPrompt?: string;
  heartbeatEnabled: boolean;
  /** Phase 4: runtime selection (defaults to "cli" for backward compat) */
  runtime?: RuntimeKind;
  /** Phase 4: model for SDK runtimes */
  model?: string;
  /** Phase 4: allowed tools for SDK runtimes */
  tools?: string[];
  /** Phase 4: disallowed tools for SDK runtimes */
  disallowedTools?: string[];
  /** Phase 4: tools requiring approval before execution */
  approvalRequired?: string[];
  /** Phase 4: maximum budget in USD for this agent */
  maxBudgetUsd?: number;
  /** Phase 4: enable session resume across heartbeats */
  resume?: boolean;
}
