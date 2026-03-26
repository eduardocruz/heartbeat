import { Database } from "bun:sqlite";

type TaskStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "failed"
  | "cancelled";

type TaskRow = {
  id: string;
  status: TaskStatus;
  reviewer: string | null;
};

type DependencyRow = {
  task_id: string;
  blocker_task_id: string;
  satisfied_at: string | null;
};

const SATISFIED_BLOCKER_STATUSES = new Set<TaskStatus>(["done", "cancelled"]);

function isSatisfiedBlockerStatus(status: string): status is TaskStatus {
  return SATISFIED_BLOCKER_STATUSES.has(status as TaskStatus);
}

function getTask(db: Database, taskId: string): TaskRow | null {
  return (db
    .query("SELECT id, status, reviewer FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | null) ?? null;
}

function getDependencyRows(db: Database, taskId: string): DependencyRow[] {
  return db
    .query(
      "SELECT task_id, blocker_task_id, satisfied_at FROM task_dependencies WHERE task_id = ? ORDER BY rowid ASC",
    )
    .all(taskId) as DependencyRow[];
}

function getAllBlockerIds(db: Database, taskId: string): string[] {
  return getDependencyRows(db, taskId).map((row) => row.blocker_task_id);
}

function canResumeTask(db: Database, taskId: string): boolean {
  const rows = getDependencyRows(db, taskId);
  return rows.length > 0 && rows.every((row) => row.satisfied_at !== null);
}

function insertTaskComment(db: Database, taskId: string, body: string, status: string, reviewer: string | null): void {
  db.query("INSERT INTO task_comments (task_id, body, status, reviewer) VALUES (?, ?, ?, ?)").run(
    taskId,
    body,
    status,
    reviewer,
  );
}

function buildResumeComment(blockerIds: string[]): string {
  const blockers = blockerIds.join(", ");
  return `Automatically resumed after blockers resolved: ${blockers}`;
}

export function listTaskBlockerIds(db: Database, taskId: string): string[] {
  return getAllBlockerIds(db, taskId);
}

export function attachTaskDependencies<T extends { id: string }>(db: Database, task: T): T & { blocked_by_task_ids: string[] } {
  return {
    ...task,
    blocked_by_task_ids: listTaskBlockerIds(db, task.id),
  };
}

export function attachTaskDependenciesBulk<T extends { id: string }>(
  db: Database,
  tasks: T[],
): Array<T & { blocked_by_task_ids: string[] }> {
  if (tasks.length === 0) {
    return [];
  }

  const blockerRows = db
    .query("SELECT task_id, blocker_task_id FROM task_dependencies ORDER BY rowid ASC")
    .all() as Array<{ task_id: string; blocker_task_id: string }>;
  const blockersByTaskId = new Map<string, string[]>();

  for (const row of blockerRows) {
    const existing = blockersByTaskId.get(row.task_id);
    if (existing) {
      existing.push(row.blocker_task_id);
      continue;
    }

    blockersByTaskId.set(row.task_id, [row.blocker_task_id]);
  }

  return tasks.map((task) => ({
    ...task,
    blocked_by_task_ids: blockersByTaskId.get(task.id) ?? [],
  }));
}

export function normalizeTaskDependencyIds(value: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "blocked_by_task_ids must be an array of task ids" };
  }

  const normalizedIds: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return { ok: false, error: "blocked_by_task_ids must contain non-empty task ids" };
    }

    const trimmed = entry.trim();
    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalizedIds.push(trimmed);
  }

  return { ok: true, ids: normalizedIds };
}

export function syncTaskDependencies(db: Database, taskId: string, blockerIds: string[]): { ok: true } | { ok: false; error: string } {
  if (blockerIds.includes(taskId)) {
    return { ok: false, error: "blocked_by_task_ids cannot include the task itself" };
  }

  for (const blockerId of blockerIds) {
    const blocker = getTask(db, blockerId);
    if (!blocker) {
      return { ok: false, error: `Task not found for blocker id: ${blockerId}` };
    }
  }

  const existingRows = getDependencyRows(db, taskId);
  const existingIds = new Set(existingRows.map((row) => row.blocker_task_id));

  for (const row of existingRows) {
    if (!blockerIds.includes(row.blocker_task_id)) {
      db.query("DELETE FROM task_dependencies WHERE task_id = ? AND blocker_task_id = ?").run(taskId, row.blocker_task_id);
    }
  }

  for (const blockerId of blockerIds) {
    const blocker = getTask(db, blockerId);
    if (!blocker) {
      continue;
    }

    const satisfiedAt = isSatisfiedBlockerStatus(blocker.status) ? new Date().toISOString() : null;
    if (existingIds.has(blockerId)) {
      db.query(
        "UPDATE task_dependencies SET satisfied_at = ? WHERE task_id = ? AND blocker_task_id = ?",
      ).run(satisfiedAt, taskId, blockerId);
      continue;
    }

    db.query(
      "INSERT INTO task_dependencies (task_id, blocker_task_id, satisfied_at) VALUES (?, ?, ?)",
    ).run(taskId, blockerId, satisfiedAt);
  }

  return { ok: true };
}

export function reconcileBlockedDependents(db: Database, blockerTaskId: string, previousStatus: string, nextStatus: string): void {
  const wasSatisfied = isSatisfiedBlockerStatus(previousStatus);
  const isSatisfied = isSatisfiedBlockerStatus(nextStatus);

  if (wasSatisfied === isSatisfied) {
    return;
  }

  const dependents = db
    .query("SELECT task_id FROM task_dependencies WHERE blocker_task_id = ? ORDER BY rowid ASC")
    .all(blockerTaskId) as Array<{ task_id: string }>;

  for (const dependent of dependents) {
    db.query(
      "UPDATE task_dependencies SET satisfied_at = ? WHERE task_id = ? AND blocker_task_id = ?",
    ).run(isSatisfied ? new Date().toISOString() : null, dependent.task_id, blockerTaskId);

    if (!isSatisfied) {
      continue;
    }

    const task = getTask(db, dependent.task_id);
    if (!task || task.status !== "blocked" || !canResumeTask(db, dependent.task_id)) {
      continue;
    }

    db.query(
      "UPDATE tasks SET status = 'todo', started_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'blocked'",
    ).run(dependent.task_id);

    insertTaskComment(
      db,
      dependent.task_id,
      buildResumeComment(getAllBlockerIds(db, dependent.task_id)),
      "todo",
      task.reviewer,
    );
  }
}
