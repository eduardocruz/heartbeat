import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  attachTaskDependencies,
  attachTaskDependenciesBulk,
  normalizeTaskDependencyIds,
  reconcileBlockedDependents,
  syncTaskDependencies,
} from "../../tasks/dependencies";
import { canTransitionTaskStatus, isTaskStatus, normalizeTaskStatus } from "../../tasks/workflow";
import { parseBoundedPositiveInt, readJsonObject } from "../http";

const TASK_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const MAX_TASK_LIST_LIMIT = 500;
type SqlParam = string | number | bigint | boolean | Uint8Array | null;

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  agent: string | null;
  reviewer: string | null;
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

type TaskCommentRow = {
  id: string;
  task_id: string;
  body: string;
  status: string | null;
  reviewer: string | null;
  created_at: string;
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

function normalizeOptionalString(value: unknown): string | null {
  const normalized = optionalString(value);
  return normalized === null ? null : normalized.trim() || null;
}

function insertTaskComment(
  db: Database,
  taskId: string,
  body: string,
  status: string | null,
  reviewer: string | null,
): void {
  db.query("INSERT INTO task_comments (task_id, body, status, reviewer) VALUES (?, ?, ?, ?)").run(
    taskId,
    body,
    status,
    reviewer,
  );
}

function applyLifecycleTimestamps(
  updates: string[],
  existing: TaskRow,
  nextStatus: string,
): void {
  if (nextStatus === existing.status) {
    return;
  }

  if (nextStatus === "todo") {
    updates.push("started_at = NULL", "completed_at = NULL");
    return;
  }

  if (nextStatus === "in_progress") {
    if (existing.started_at === null) {
      updates.push("started_at = datetime('now')");
    }
    updates.push("completed_at = NULL");
    return;
  }

  if (nextStatus === "in_review" || nextStatus === "blocked") {
    updates.push("completed_at = NULL");
    return;
  }

  if (nextStatus === "done" || nextStatus === "failed" || nextStatus === "cancelled") {
    updates.push("completed_at = datetime('now')");
  }
}

export function createTasksRoutes(db: Database): Hono {
  const tasksRoutes = new Hono();

  tasksRoutes.get("/", (c) => {
    const status = c.req.query("status");
    const agent = c.req.query("agent");
    const limitRaw = c.req.query("limit");

    const normalizedStatus = status ? normalizeTaskStatus(status) : null;

    if (normalizedStatus && !isTaskStatus(normalizedStatus)) {
      return c.json({ error: "Invalid status filter" }, 400);
    }

    const limitResult = parseBoundedPositiveInt(limitRaw, "limit", {
      defaultValue: 100,
      max: MAX_TASK_LIST_LIMIT,
    });
    if (!limitResult.ok) {
      return c.json({ error: limitResult.error }, 400);
    }
    const limit = limitResult.value;

    const clauses: string[] = [];
    const params: SqlParam[] = [];

    if (normalizedStatus) {
      clauses.push("status = ?");
      params.push(normalizedStatus);
    }

    if (agent) {
      clauses.push("agent = ?");
      params.push(agent);
    }

    params.push(limit);

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT ?`;

    const tasks = db.query(sql).all(...params) as TaskRow[];
    return c.json(attachTaskDependenciesBulk(db, tasks));
  });

  tasksRoutes.post("/", async (c) => {
    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (!isNonEmptyString(body.title)) {
      return c.json({ error: "title is required" }, 400);
    }

    const priority = body.priority ?? "medium";
    if (typeof priority !== "string" || !TASK_PRIORITIES.has(priority)) {
      return c.json({ error: "Invalid priority" }, 400);
    }

    const status = normalizeTaskStatus(typeof body.status === "string" ? body.status : "todo");
    if (!isTaskStatus(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    const reviewer = normalizeOptionalString(body.reviewer);
    if (status === "in_review" && !reviewer) {
      return c.json({ error: "reviewer is required when status is in_review" }, 400);
    }

    let blockerIds: string[] = [];
    if ("blocked_by_task_ids" in body) {
      const parsed = normalizeTaskDependencyIds(body.blocked_by_task_ids);
      if (!parsed.ok) {
        return c.json({ error: parsed.error }, 400);
      }
      blockerIds = parsed.ids;
    }

    const result = db
      .query(
        `INSERT INTO tasks (title, description, status, priority, agent, reviewer, repo_url, branch, result_summary, commit_hash, exit_code, stdout, stderr, timeout_seconds, started_at, completed_at, tool, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        body.title.trim(),
        optionalString(body.description),
        status,
        priority,
        optionalString(body.agent),
        reviewer,
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
        normalizeOptionalString(body.tool),
      );

    const created = db.query("SELECT * FROM tasks WHERE rowid = ?").get(result.lastInsertRowid) as
      | TaskRow
      | null;

    if (!created) {
      return c.json({ error: "Task not found after creation" }, 500);
    }

    const syncResult = syncTaskDependencies(db, created.id, blockerIds);
    if (!syncResult.ok) {
      db.query("DELETE FROM tasks WHERE id = ?").run(created.id);
      return c.json({ error: syncResult.error }, 400);
    }

    return c.json(attachTaskDependencies(db, created), 201);
  });

  tasksRoutes.get("/:id", (c) => {
    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(c.req.param("id")) as TaskRow | null;

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json(attachTaskDependencies(db, task));
  });

  tasksRoutes.get("/:id/comments", (c) => {
    const task = db.query("SELECT id FROM tasks WHERE id = ?").get(c.req.param("id")) as { id: string } | null;
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const comments = db
      .query("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(task.id) as TaskCommentRow[];
    return c.json(comments);
  });

  tasksRoutes.post("/:id/comments", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (!isNonEmptyString(body.body)) {
      return c.json({ error: "body is required" }, 400);
    }

    const status = body.status === undefined ? existing.status : normalizeTaskStatus(String(body.status));
    if (!isTaskStatus(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    if (status !== normalizeTaskStatus(existing.status)) {
      return c.json({ error: "comment status must match the current task status; use PATCH to change status" }, 400);
    }

    const reviewer = body.reviewer === undefined ? existing.reviewer : normalizeOptionalString(body.reviewer);
    if ((reviewer ?? null) !== (existing.reviewer ?? null)) {
      return c.json({ error: "comment reviewer must match the current task reviewer; use PATCH to change reviewer" }, 400);
    }

    if (status === "in_review" && !reviewer) {
      return c.json({ error: "reviewer is required when status is in_review" }, 400);
    }

    insertTaskComment(db, id, body.body.trim(), status, reviewer ?? null);

    const created = db
      .query("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(id) as TaskCommentRow;
    return c.json(created, 201);
  });

  tasksRoutes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    const allowedFields = [
      "title",
      "description",
      "status",
      "priority",
      "agent",
      "reviewer",
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
    let nextStatus = existing.status;
    let nextReviewer = existing.reviewer;
    let comment: string | null = null;
    let nextBlockerIds: string[] | null = null;

    if ("comment" in body) {
      if (!isNonEmptyString(body.comment)) {
        return c.json({ error: "comment must be a non-empty string" }, 400);
      }
      comment = body.comment.trim();
    }

    if ("blocked_by_task_ids" in body) {
      const parsed = normalizeTaskDependencyIds(body.blocked_by_task_ids);
      if (!parsed.ok) {
        return c.json({ error: parsed.error }, 400);
      }
      nextBlockerIds = parsed.ids;
    }

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
        if (typeof value !== "string") {
          return c.json({ error: "Invalid status" }, 400);
        }
        const normalized = normalizeTaskStatus(value);
        if (!isTaskStatus(normalized)) {
          return c.json({ error: "Invalid status" }, 400);
        }
        if (!canTransitionTaskStatus(existing.status, normalized)) {
          return c.json({ error: `Invalid status transition from ${existing.status} to ${normalized}` }, 400);
        }
        updates.push(`${field} = ?`);
        params.push(normalized);
        nextStatus = normalized;
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

      if (field === "reviewer") {
        if (value !== null && value !== undefined && typeof value !== "string") {
          return c.json({ error: "reviewer must be a string or null" }, 400);
        }
        const normalizedReviewer = normalizeOptionalString(value);
        updates.push(`${field} = ?`);
        params.push(normalizedReviewer);
        nextReviewer = normalizedReviewer;
        continue;
      }

      if (value !== null && value !== undefined && typeof value !== "string") {
        return c.json({ error: `${field} must be a string or null` }, 400);
      }

      updates.push(`${field} = ?`);
      params.push(value ?? null);
    }

    if (nextStatus === "in_review" && !nextReviewer) {
      return c.json({ error: "reviewer is required when status is in_review" }, 400);
    }

    if (updates.length === 0 && comment === null) {
      return c.json({ error: "No valid fields provided" }, 400);
    }

    if (updates.length > 0) {
      applyLifecycleTimestamps(updates, existing, nextStatus);
      updates.push("updated_at = datetime('now')");
      params.push(id);

      const sql = `UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`;
      db.query(sql).run(...params);
    }

    if (nextBlockerIds !== null) {
      const syncResult = syncTaskDependencies(db, id, nextBlockerIds);
      if (!syncResult.ok) {
        return c.json({ error: syncResult.error }, 400);
      }
    }

    if (comment !== null) {
      insertTaskComment(db, id, comment, nextStatus, nextReviewer);
    }

    const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
    reconcileBlockedDependents(db, id, existing.status, nextStatus);
    return c.json(attachTaskDependencies(db, updated));
  });

  tasksRoutes.post("/:id/retry", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    if (existing.status !== "failed" && existing.status !== "cancelled") {
      return c.json({ error: `Can only retry tasks with status failed or cancelled, current status: ${existing.status}` }, 400);
    }

    db.query(
      "UPDATE tasks SET status = 'todo', exit_code = NULL, stdout = NULL, stderr = NULL, started_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(id);

    insertTaskComment(db, id, `Task requeued for retry (was ${existing.status})`, "todo", null);

    const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
    return c.json(attachTaskDependencies(db, updated));
  });

  tasksRoutes.get("/:id/runs", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT id FROM tasks WHERE id = ?").get(id) as { id: string } | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const runs = db
      .query("SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC")
      .all(id);
    return c.json(runs);
  });

  tasksRoutes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    if (!canTransitionTaskStatus(existing.status, "cancelled")) {
      return c.json({ error: `Invalid status transition from ${existing.status} to cancelled` }, 400);
    }

    db.query("UPDATE tasks SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    const cancelled = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
    reconcileBlockedDependents(db, id, existing.status, "cancelled");
    return c.json(attachTaskDependencies(db, cancelled));
  });

  return tasksRoutes;
}
