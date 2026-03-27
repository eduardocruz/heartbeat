import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { parseBoundedPositiveInt } from "../http";

type SqlParam = string | number | bigint | boolean | Uint8Array | null;

const MAX_RUNS_LIMIT = 500;

type RunRow = {
  id: string;
  task_id: string;
  agent: string;
  status: string;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  commit_hash: string | null;
  workspace_dir: string | null;
  timed_out: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export function createRunsRoutes(db: Database): Hono {
  const runsRoutes = new Hono();

  runsRoutes.get("/", (c) => {
    const taskId = c.req.query("task_id");
    const agent = c.req.query("agent");
    const status = c.req.query("status");
    const limitRaw = c.req.query("limit");

    const limitResult = parseBoundedPositiveInt(limitRaw, "limit", {
      defaultValue: 50,
      max: MAX_RUNS_LIMIT,
    });
    if (!limitResult.ok) {
      return c.json({ error: limitResult.error }, 400);
    }

    const clauses: string[] = [];
    const params: SqlParam[] = [];

    if (taskId) {
      clauses.push("r.task_id = ?");
      params.push(taskId);
    }
    if (agent) {
      clauses.push("r.agent = ?");
      params.push(agent);
    }
    if (status) {
      clauses.push("r.status = ?");
      params.push(status);
    }

    params.push(limitResult.value);

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT r.*, t.title AS task_title FROM runs r LEFT JOIN tasks t ON r.task_id = t.id ${whereClause} ORDER BY r.started_at DESC LIMIT ?`;

    const runs = db.query(sql).all(...params) as (RunRow & { task_title: string | null })[];
    return c.json(runs);
  });

  runsRoutes.get("/:id", (c) => {
    const run = db
      .query("SELECT r.*, t.title AS task_title FROM runs r LEFT JOIN tasks t ON r.task_id = t.id WHERE r.id = ?")
      .get(c.req.param("id")) as (RunRow & { task_title: string | null }) | null;

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    return c.json(run);
  });

  return runsRoutes;
}
