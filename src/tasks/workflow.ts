export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const STATUS_SET = new Set<string>(TASK_STATUSES);

const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  pending: "todo",
  assigned: "todo",
  running: "in_progress",
};

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["todo", "in_review", "done", "blocked", "failed", "cancelled"],
  in_review: ["in_progress", "done", "blocked", "cancelled"],
  done: [],
  blocked: ["todo", "in_progress", "cancelled"],
  failed: ["todo", "in_progress", "cancelled"],
  cancelled: [],
};

export function normalizeTaskStatus(status: string): string {
  return LEGACY_STATUS_MAP[status] ?? status;
}

export function isTaskStatus(status: string): status is TaskStatus {
  return STATUS_SET.has(normalizeTaskStatus(status));
}

export function canTransitionTaskStatus(current: string, next: string): boolean {
  const normalizedCurrent = normalizeTaskStatus(current);
  const normalizedNext = normalizeTaskStatus(next);

  if (!isTaskStatus(normalizedCurrent) || !isTaskStatus(normalizedNext)) {
    return false;
  }

  if (normalizedCurrent === normalizedNext) {
    return true;
  }

  return TASK_TRANSITIONS[normalizedCurrent].includes(normalizedNext);
}

export function isActiveTaskStatus(status: string): boolean {
  const normalized = normalizeTaskStatus(status);
  return normalized === "todo" || normalized === "in_progress" || normalized === "in_review" || normalized === "blocked";
}
