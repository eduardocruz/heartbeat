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

type RunEventRow = {
  id: string;
  run_id: string;
  event_type: string;
  data: string | null;
  created_at: string;
};

function serializeEvent(event: RunEventRow) {
  return {
    ...event,
    data: event.data != null ? JSON.parse(event.data) : null,
  };
}

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

  runsRoutes.get("/:id/events", (c) => {
    const runId = c.req.param("id");
    const run = db.query("SELECT id FROM runs WHERE id = ?").get(runId) as { id: string } | null;
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const events = db
      .query("SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as RunEventRow[];

    return c.json(events.map(serializeEvent));
  });

  runsRoutes.post("/:id/events", async (c) => {
    const runId = c.req.param("id");
    const run = db.query("SELECT id FROM runs WHERE id = ?").get(runId) as { id: string } | null;
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const eventType = (body as Record<string, unknown>).event_type;
    if (!eventType || typeof eventType !== "string") {
      return c.json({ error: "event_type is required" }, 400);
    }

    const rawData = (body as Record<string, unknown>).data;
    const dataJson = rawData !== undefined ? JSON.stringify(rawData) : null;

    const result = db
      .query("INSERT INTO run_events (run_id, event_type, data) VALUES (?, ?, ?)")
      .run(runId, eventType, dataJson);

    const event = db
      .query("SELECT * FROM run_events WHERE rowid = ?")
      .get(result.lastInsertRowid) as RunEventRow;

    return c.json(serializeEvent(event), 201);
  });

  runsRoutes.get("/:id/events/stream", (c) => {
    const runId = c.req.param("id");
    const run = db.query("SELECT id, status FROM runs WHERE id = ?").get(runId) as { id: string; status: string } | null;
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        let lastId: string | null = null;

        function flush() {
          const query = lastId
            ? db.query("SELECT * FROM run_events WHERE run_id = ? AND created_at > (SELECT created_at FROM run_events WHERE id = ?) ORDER BY created_at ASC")
            : db.query("SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC");

          const events = (lastId ? query.all(runId, lastId) : query.all(runId)) as RunEventRow[];

          for (const event of events) {
            const payload = JSON.stringify(serializeEvent(event));
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            lastId = event.id;
          }

          const current = db.query("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | null;
          if (!current || current.status === "done" || current.status === "failed") {
            controller.enqueue(encoder.encode("data: {\"event_type\":\"stream_end\"}\n\n"));
            controller.close();
            return;
          }

          setTimeout(flush, 1000);
        }

        flush();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return runsRoutes;
}
