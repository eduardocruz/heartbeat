import { Database } from "bun:sqlite";
import { Hono } from "hono";

const TASK_STATUSES = new Set([
  "pending",
  "assigned",
  "running",
  "done",
  "failed",
  "cancelled",
]);

const TASK_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
type SqlParam = string | number | bigint | boolean | Uint8Array | null;

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  agent: string | null;
  repo_url: string | null;
  branch: string | null;
  result_summary: string | null;
  commit_hash: string | null;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  timeout_seconds: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

export function createTasksRoutes(db: Database): Hono {
  const tasksRoutes = new Hono();

  tasksRoutes.get("/", (c) => {
    const status = c.req.query("status");
    const agent = c.req.query("agent");
    const limitRaw = c.req.query("limit");

    if (status && !TASK_STATUSES.has(status)) {
      return c.json({ error: "Invalid status filter" }, 400);
    }

    let limit = 100;
    if (limitRaw !== undefined) {
      const parsed = Number.parseInt(limitRaw, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return c.json({ error: "limit must be a positive integer" }, 400);
      }

      limit = parsed;
    }

    const clauses: string[] = [];
    const params: SqlParam[] = [];

    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }

    if (agent) {
      clauses.push("agent = ?");
      params.push(agent);
    }

    params.push(limit);

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT ?`;

    const tasks = db.query(sql).all(...params) as TaskRow[];
    return c.json(tasks);
  });

  tasksRoutes.post("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isNonEmptyString(body.title)) {
      return c.json({ error: "title is required" }, 400);
    }

    const priority = body.priority ?? "medium";
    if (typeof priority !== "string" || !TASK_PRIORITIES.has(priority)) {
      return c.json({ error: "Invalid priority" }, 400);
    }

    const status = body.status ?? "pending";
    if (typeof status !== "string" || !TASK_STATUSES.has(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    const result = db
      .query(
        `INSERT INTO tasks (title, description, status, priority, agent, repo_url, branch, result_summary, commit_hash, exit_code, stdout, stderr, timeout_seconds, started_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        body.title.trim(),
        optionalString(body.description),
        status,
        priority,
        optionalString(body.agent),
        optionalString(body.repo_url),
        optionalString(body.branch),
        optionalString(body.result_summary),
        optionalString(body.commit_hash),
        typeof body.exit_code === "number" ? body.exit_code : null,
        optionalString(body.stdout),
        optionalString(body.stderr),
        typeof body.timeout_seconds === "number" ? body.timeout_seconds : null,
        optionalString(body.started_at),
        optionalString(body.completed_at),
      );

    const created = db.query("SELECT * FROM tasks WHERE rowid = ?").get(result.lastInsertRowid) as
      | TaskRow
      | null;

    return c.json(created, 201);
  });

  tasksRoutes.get("/:id", (c) => {
    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(c.req.param("id")) as TaskRow | null;

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json(task);
  });

  tasksRoutes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const allowedFields = [
      "title",
      "description",
      "status",
      "priority",
      "agent",
      "repo_url",
      "branch",
      "result_summary",
      "commit_hash",
      "exit_code",
      "stdout",
      "stderr",
      "timeout_seconds",
      "started_at",
      "completed_at",
    ];

    const updates: string[] = [];
    const params: SqlParam[] = [];

    for (const field of allowedFields) {
      if (!(field in body)) {
        continue;
      }

      const value = body[field];

      if (field === "title") {
        if (!isNonEmptyString(value)) {
          return c.json({ error: "title must be a non-empty string" }, 400);
        }
        updates.push(`${field} = ?`);
        params.push(value.trim());
        continue;
      }

      if (field === "status") {
        if (typeof value !== "string" || !TASK_STATUSES.has(value)) {
          return c.json({ error: "Invalid status" }, 400);
        }
        updates.push(`${field} = ?`);
        params.push(value);
        continue;
      }

      if (field === "priority") {
        if (typeof value !== "string" || !TASK_PRIORITIES.has(value)) {
          return c.json({ error: "Invalid priority" }, 400);
        }
        updates.push(`${field} = ?`);
        params.push(value);
        continue;
      }

      if (field === "exit_code") {
        if (value !== null && typeof value !== "number") {
          return c.json({ error: "exit_code must be a number or null" }, 400);
        }
        updates.push(`${field} = ?`);
        params.push(value);
        continue;
      }

      if (field === "timeout_seconds") {
        if (value !== null && (!Number.isInteger(value) || Number(value) <= 0)) {
          return c.json({ error: "timeout_seconds must be a positive integer or null" }, 400);
        }
        updates.push(`${field} = ?`);
        params.push((value as number | null) ?? null);
        continue;
      }

      if (value !== null && value !== undefined && typeof value !== "string") {
        return c.json({ error: `${field} must be a string or null` }, 400);
      }

      updates.push(`${field} = ?`);
      params.push(value ?? null);
    }

    if (updates.length === 0) {
      return c.json({ error: "No valid fields provided" }, 400);
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    const sql = `UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`;
    db.query(sql).run(...params);

    const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
    return c.json(updated);
  });

  tasksRoutes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    db.query("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(id);
    const cancelled = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
    return c.json(cancelled);
  });

  return tasksRoutes;
}
