export const STATUS_TABS = ["all", "todo", "in_progress", "in_review", "done", "blocked", "failed", "cancelled"];
export const TASK_STATUS_OPTIONS = ["todo", "in_progress", "in_review", "done", "blocked", "failed", "cancelled"];
export const ACTIVE_TASK_STATUSES = new Set(["todo", "in_progress", "in_review", "blocked"]);

export const STATUS_BADGE = {
  todo: "badge badge-todo",
  in_progress: "badge badge-running status-running",
  in_review: "badge badge-review",
  done: "badge badge-done",
  blocked: "badge badge-blocked",
  failed: "badge badge-failed",
  cancelled: "badge badge-blocked",
};

export const PRIORITY_BADGE = {
  critical: "badge badge-critical",
  high: "badge badge-high",
  medium: "badge badge-medium",
  low: "badge badge-low",
};

export const RUN_STATUS_BADGE = {
  running: "badge badge-running status-running",
  done: "badge badge-done",
  failed: "badge badge-failed",
};

export const APPROVAL_STATUS_BADGE = {
  pending: "badge badge-blocked",
  approved: "badge badge-done",
  denied: "badge badge-failed",
};

export const SOURCE_BADGE = {
  claude_code: "badge badge-medium",
  manual: "badge badge-low",
};

export const PRIORITY_WEIGHT = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const HEATMAP_COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
