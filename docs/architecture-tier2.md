# HeartBeat Tier 2 Architecture: Native Agent SDK Integration

## 1. Two-Tier Agent Model

HeartBeat keeps a single scheduling and governance surface while supporting two execution runtimes:

- Tier 1: CLI adapters (existing) that execute shell commands and capture stdout/stderr.
- Tier 2: SDK adapters (new) that run native agent SDK sessions (Anthropic Agent SDK, OpenAI Agents SDK).

The scheduler does not branch by provider. It picks runnable tasks and dispatches through a runtime registry that hides runtime details.

```ts
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
```

## 2. SDK Integration Points

Tier 2 runtime adapters consume provider SDK streaming/tool hooks and map them to HeartBeat governance events.

### Hook Mapping

- `PreToolUse` -> governance preflight (`allow`, `deny`, `require_approval`).
- `PostToolUse` -> audit event append + usage aggregation.
- `OnMessage`/`OnReasoning` -> stream chunks to UI observers.
- `OnSessionEnd` -> finalize task status and persist session snapshot.

```ts
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
```

### Approval Gates

For tools in `approval_required`, the runtime pauses before tool execution:

1. Emit `approval.pending` run event.
2. Create/update Paperclip approval record.
3. Suspend provider stream.
4. Resume only on approved response; otherwise fail task as blocked/denied.

### Budget Tracking

Every token report from SDK callbacks is normalized into `RuntimeUsage`. Budget checks happen:

- pre-run: reject if monthly/company limit exceeded.
- mid-run: stop execution when `max_budget_usd` threshold is crossed.
- post-run: persist aggregated usage by run + issue + agent.

### Session Persistence

Tier 2 stores resumable session state per issue-agent pair:

```ts
export interface PersistedSdkSession {
  issueId: string;
  agentId: string;
  runtime: Exclude<RuntimeKind, "cli">;
  providerSessionId: string;
  stateBlob: string;
  lastEventSeq: number;
  updatedAt: string;
}
```

On next heartbeat, runtime loads this session if `resume=true`, appends new prompt context, and continues.

## 3. YAML Config for SDK Agents

Extend the current `agents` configuration shape with runtime-specific controls while preserving existing CLI fields.

```yaml
agents:
  engineer:
    runtime: claude-agent-sdk
    model: sonnet
    tools: [Read, Edit, Bash]
    disallowed_tools: [WebFetch]
    max_budget_usd: 5.00
    approval_required: [Bash, Write]
    resume: true
    heartbeat: "*/30 * * * *"
```

Proposed normalized TypeScript shape:

```ts
export interface AgentRuntimeConfig {
  id: string;
  runtime: RuntimeKind;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  approvalRequired?: string[];
  maxBudgetUsd?: number;
  resume?: boolean;
  heartbeatCron?: string;
  commandTemplate?: string; // Tier 1 CLI only
}
```

Validation rules:

- `runtime=cli` requires `commandTemplate`.
- SDK runtimes require `model`.
- A tool cannot exist in both `tools` and `disallowedTools`.
- `approvalRequired` must be a subset of allowed tools.

## 4. Streaming and Observability

Tier 2 introduces event streaming as first-class infrastructure.

### Event Bus

All runtimes write to one run event stream:

```ts
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
```

### WebSocket Delivery

- API exposes `/api/runs/:runId/stream` (WebSocket).
- Server fans out `RunEvent` messages in order (`seq`).
- Clients reconnect with `lastSeq` to replay missed events from DB.

### Dashboard Signals

The UI can render:

- current run state (`starting`, `waiting_approval`, `tool_running`, `completed`),
- live token/cost deltas,
- tool call timeline with decisions and approval latency.

This makes each governance decision auditable and observable in real time.

## 5. Multi-Provider Runtime Interface

All providers implement the same runtime contract so scheduler/executor code does not fork.

```ts
export interface AgentRuntime {
  kind: RuntimeKind;
  canResume(): boolean;
  validate(config: AgentRuntimeConfig): void;
  run(input: RuntimeDispatchInput, deps: RuntimeDependencies): Promise<RuntimeDispatchResult>;
}

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
```

Provider adapters:

- `CliRuntime` (existing behavior wrapped in interface).
- `ClaudeAgentSdkRuntime`.
- `OpenAIAgentSdkRuntime`.

Adding a new provider is now "implement `AgentRuntime` + register in runtime registry".

## 6. Migration Path

Migration is incremental and backward compatible.

1. Introduce `AgentRuntime` interface and wrap current executor logic in `CliRuntime`.
2. Add run event table + WebSocket stream endpoint (used by CLI and SDK).
3. Add config parsing/validation for `runtime`, `model`, governance and budget fields.
4. Add session persistence storage and plumb `resume` behavior.
5. Implement `ClaudeAgentSdkRuntime` behind feature flag (`HB_TIER2_CLAUDE=1`).
6. Implement `OpenAIAgentSdkRuntime` behind feature flag (`HB_TIER2_OPENAI=1`).
7. Default new agents to `cli`; opt-in existing agents per config.

No breaking changes required:

- Existing tasks, agents, CLI command templates, scheduler, and DB records continue to work.
- Tier 2 only activates for agents whose runtime is explicitly set to an SDK runtime.

## Implementation Notes for Contributors

- Keep governance decisions provider-agnostic in `GovernancePolicyEngine`; do not encode Anthropic/OpenAI specifics there.
- Normalize provider token reports immediately into `RuntimeUsage`.
- Ensure every emitted event has monotonic `seq` per run to support replay.
- Treat approvals as resumable state transitions, not ad-hoc blocking sleeps.
