import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { readJsonObject } from "../http";

type SqlParam = string | number | bigint | boolean | Uint8Array | null;

type ApprovalRow = {
  id: string;
  agent_id: string;
  run_id: string | null;
  task_id: string | null;
  reason: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

const VALID_STATUSES = new Set(["pending", "approved", "denied"]);
const RESOLUTION_STATUSES = new Set(["approved", "denied"]);

export function createApprovalsRoutes(db: Database): Hono {
  const approvalsRoutes = new Hono();

  approvalsRoutes.get("/", (c) => {
    const status = c.req.query("status");
    const agentId = c.req.query("agent_id");

    const clauses: string[] = [];
    const params: SqlParam[] = [];

    if (status) {
      if (!VALID_STATUSES.has(status)) {
        return c.json({ error: "Invalid status" }, 400);
      }
      clauses.push("status = ?");
      params.push(status);
    }

    if (agentId) {
      clauses.push("agent_id = ?");
      params.push(agentId);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const approvals = db
      .query(`SELECT * FROM approvals ${whereClause} ORDER BY created_at DESC`)
      .all(...params) as ApprovalRow[];

    return c.json(approvals);
  });

  approvalsRoutes.post("/", async (c) => {
    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (typeof body.agent_id !== "string" || !body.agent_id.trim()) {
      return c.json({ error: "agent_id is required" }, 400);
    }

    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return c.json({ error: "reason is required" }, 400);
    }

    const runId = typeof body.run_id === "string" && body.run_id.trim() ? body.run_id.trim() : null;
    const taskId = typeof body.task_id === "string" && body.task_id.trim() ? body.task_id.trim() : null;

    const result = db
      .query(
        "INSERT INTO approvals (agent_id, run_id, task_id, reason, status) VALUES (?, ?, ?, ?, 'pending')",
      )
      .run(body.agent_id.trim(), runId, taskId, body.reason.trim());

    const created = db.query("SELECT * FROM approvals WHERE rowid = ?").get(result.lastInsertRowid) as ApprovalRow;
    return c.json(created, 201);
  });

  approvalsRoutes.get("/:id", (c) => {
    const approval = db.query("SELECT * FROM approvals WHERE id = ?").get(c.req.param("id")) as ApprovalRow | null;
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json(approval);
  });

  approvalsRoutes.patch("/:id", async (c) => {
    const existing = db.query("SELECT * FROM approvals WHERE id = ?").get(c.req.param("id")) as ApprovalRow | null;
    if (!existing) {
      return c.json({ error: "Approval not found" }, 404);
    }

    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (typeof body.status !== "string" || !RESOLUTION_STATUSES.has(body.status)) {
      return c.json({ error: "status must be 'approved' or 'denied'" }, 400);
    }

    const resolvedBy = typeof body.resolved_by === "string" && body.resolved_by.trim() ? body.resolved_by.trim() : null;

    db.query(
      "UPDATE approvals SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?",
    ).run(body.status, resolvedBy, c.req.param("id"));

    const updated = db.query("SELECT * FROM approvals WHERE id = ?").get(c.req.param("id")) as ApprovalRow;
    return c.json(updated);
  });

  return approvalsRoutes;
}
