/**
 * Phase 4 — GovernancePolicyEngine implementation
 *
 * Provider-agnostic governance that applies tool policies
 * consistently across CLI and SDK runtimes.
 */

import type { Database } from "bun:sqlite";
import type { GovernancePolicyEngine, GovernancePolicyContext, ToolDecision } from "./runtime";

export class SqliteGovernancePolicyEngine implements GovernancePolicyEngine {
  constructor(private readonly db: Database) {}

  async preToolUse(ctx: GovernancePolicyContext): Promise<{
    decision: ToolDecision;
    reason?: string;
    approvalRequestId?: string;
  }> {
    const policyRow = this.db
      .query("SELECT denied_tools, approval_required_tools FROM agent_policies WHERE agent_id = ?")
      .get(ctx.agentId) as { denied_tools: string; approval_required_tools: string } | null;

    if (!policyRow) {
      return { decision: "allow" };
    }

    const deniedTools = JSON.parse(policyRow.denied_tools) as string[];
    const approvalTools = JSON.parse(policyRow.approval_required_tools) as string[];

    if (deniedTools.includes(ctx.toolName)) {
      return {
        decision: "deny",
        reason: `Tool "${ctx.toolName}" is denied by agent policy`,
      };
    }

    if (approvalTools.includes(ctx.toolName)) {
      // Create approval record
      const agentIdRow = this.db
        .query("SELECT id FROM agents WHERE id = ? OR name = ? LIMIT 1")
        .get(ctx.agentId, ctx.agentId) as { id: string } | null;

      if (agentIdRow) {
        const result = this.db
          .query(
            "INSERT INTO approvals (agent_id, task_id, reason, status) VALUES (?, ?, ?, 'pending')",
          )
          .run(
            agentIdRow.id,
            ctx.issueId,
            `Tool "${ctx.toolName}" requires approval per agent policy (runtime: ${ctx.runtime})`,
          );

        const approvalRow = this.db
          .query("SELECT id FROM approvals WHERE rowid = ?")
          .get(result.lastInsertRowid) as { id: string };

        return {
          decision: "require_approval",
          reason: `Tool "${ctx.toolName}" requires approval`,
          approvalRequestId: approvalRow.id,
        };
      }

      return {
        decision: "require_approval",
        reason: `Tool "${ctx.toolName}" requires approval per agent policy`,
      };
    }

    return { decision: "allow" };
  }

  async postToolUse(
    ctx: GovernancePolicyContext & { output: unknown; success: boolean },
  ): Promise<void> {
    // Record tool usage as a run event for audit trail
    this.db
      .query("INSERT INTO run_events (run_id, event_type, data) VALUES (?, ?, ?)")
      .run(
        ctx.issueId,
        "tool.post",
        JSON.stringify({
          toolName: ctx.toolName,
          success: ctx.success,
          runtime: ctx.runtime,
          agentId: ctx.agentId,
        }),
      );
  }
}
