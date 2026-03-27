/**
 * Phase 4 — RuntimeDependencies wiring
 *
 * Creates the concrete RuntimeDependencies from the SQLite database,
 * wiring governance, sessions, budgets, and run events.
 */

import type { Database } from "bun:sqlite";
import type { RuntimeDependencies, RunEvent, PersistedSdkSession, RuntimeUsage } from "./runtime";
import { SqliteGovernancePolicyEngine } from "./governance";

export function createRuntimeDependencies(db: Database): RuntimeDependencies {
  const governance = new SqliteGovernancePolicyEngine(db);

  return {
    governance,

    runEvents: {
      async append(event: Omit<RunEvent, "seq">): Promise<number> {
        const result = db
          .query("INSERT INTO run_events (run_id, event_type, data) VALUES (?, ?, ?)")
          .run(event.runId, event.kind, JSON.stringify(event.payload));
        return Number(result.lastInsertRowid);
      },
    },

    sessions: {
      async load(issueId: string, agentId: string): Promise<PersistedSdkSession | null> {
        const row = db
          .query(
            "SELECT issue_id, agent_id, runtime, provider_session_id, state_blob, last_event_seq, updated_at FROM sdk_sessions WHERE issue_id = ? AND agent_id = ? LIMIT 1",
          )
          .get(issueId, agentId) as {
          issue_id: string;
          agent_id: string;
          runtime: string;
          provider_session_id: string;
          state_blob: string;
          last_event_seq: number;
          updated_at: string;
        } | null;

        if (!row) return null;

        return {
          issueId: row.issue_id,
          agentId: row.agent_id,
          runtime: row.runtime as PersistedSdkSession["runtime"],
          providerSessionId: row.provider_session_id,
          stateBlob: row.state_blob,
          lastEventSeq: row.last_event_seq,
          updatedAt: row.updated_at,
        };
      },

      async save(session: PersistedSdkSession): Promise<void> {
        db.query(
          `INSERT INTO sdk_sessions (issue_id, agent_id, runtime, provider_session_id, state_blob, last_event_seq, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(issue_id, agent_id) DO UPDATE SET
             runtime = excluded.runtime,
             provider_session_id = excluded.provider_session_id,
             state_blob = excluded.state_blob,
             last_event_seq = excluded.last_event_seq,
             updated_at = excluded.updated_at`,
        ).run(
          session.issueId,
          session.agentId,
          session.runtime,
          session.providerSessionId,
          session.stateBlob,
          session.lastEventSeq,
          session.updatedAt,
        );
      },

      async clear(issueId: string, agentId: string): Promise<void> {
        db.query("DELETE FROM sdk_sessions WHERE issue_id = ? AND agent_id = ?").run(issueId, agentId);
      },
    },

    budgets: {
      async canStart(agentId: string, maxBudgetUsd?: number): Promise<boolean> {
        const agentRow = db
          .query("SELECT budget_limit_cents FROM agents WHERE id = ? OR name = ? LIMIT 1")
          .get(agentId, agentId) as { budget_limit_cents: number | null } | null;

        const limitCents = maxBudgetUsd != null
          ? Math.round(maxBudgetUsd * 100)
          : agentRow?.budget_limit_cents ?? null;

        if (limitCents === null || limitCents <= 0) {
          return true; // no budget limit
        }

        const spentRow = db
          .query(
            "SELECT COALESCE(SUM(cost_cents), 0) AS spent FROM runs WHERE agent = ? AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')",
          )
          .get(agentId) as { spent: number };

        return spentRow.spent < limitCents;
      },

      async record(usage: RuntimeUsage & { runId: string; issueId: string; agentId: string }): Promise<void> {
        const costCents = Math.round(usage.estimatedCostUsd * 100);
        db.query("UPDATE runs SET cost_cents = COALESCE(cost_cents, 0) + ? WHERE task_id = ? AND agent = ?")
          .run(costCents, usage.issueId, usage.agentId);
      },
    },
  };
}
