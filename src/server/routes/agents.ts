import { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { Scheduler } from "../../executor/scheduler";

type SqlParam = string | number | bigint | boolean | Uint8Array | null;

type AgentRow = {
  id: string;
  name: string;
  type: string;
  command_template: string;
  active: number;
  heartbeat_cron: string | null;
  heartbeat_prompt: string | null;
  heartbeat_repo: string | null;
  heartbeat_enabled: number;
  created_at: string;
};

type AgentResponse = AgentRow & {
  heartbeat_next_run: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function withNextRun(agent: AgentRow, scheduler?: Scheduler): AgentResponse {
  const nextRun = scheduler ? scheduler.getNextRun(agent.id) : null;
  return {
    ...agent,
    heartbeat_next_run: nextRun,
  };
}

export function createAgentsRoutes(db: Database, scheduler?: Scheduler): Hono {
  const agentsRoutes = new Hono();

  agentsRoutes.get("/", (c) => {
    const agents = db.query("SELECT * FROM agents ORDER BY created_at DESC").all() as AgentRow[];
    return c.json(agents.map((agent) => withNextRun(agent, scheduler)));
  });

  agentsRoutes.post("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isNonEmptyString(body.name) || !isNonEmptyString(body.type) || !isNonEmptyString(body.command_template)) {
      return c.json({ error: "name, type, and command_template are required" }, 400);
    }

    if ("heartbeat_cron" in body && body.heartbeat_cron !== null && !isNonEmptyString(body.heartbeat_cron)) {
      return c.json({ error: "heartbeat_cron must be a non-empty string or null" }, 400);
    }

    if ("heartbeat_enabled" in body && body.heartbeat_enabled !== 0 && body.heartbeat_enabled !== 1) {
      return c.json({ error: "heartbeat_enabled must be 0 or 1" }, 400);
    }

    const heartbeatCron = optionalText(body.heartbeat_cron);

    try {
      const result = db
        .query(
          "INSERT INTO agents (name, type, command_template, active, heartbeat_cron, heartbeat_prompt, heartbeat_repo, heartbeat_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          body.name.trim(),
          body.type.trim(),
          body.command_template.trim(),
          body.active === 0 ? 0 : 1,
          heartbeatCron,
          optionalText(body.heartbeat_prompt),
          optionalText(body.heartbeat_repo),
          body.heartbeat_enabled === 1 ? 1 : 0,
        );

      scheduler?.reload();

      const created = db.query("SELECT * FROM agents WHERE rowid = ?").get(result.lastInsertRowid) as AgentRow;
      return c.json(withNextRun(created, scheduler), 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent name must be unique" }, 400);
      }
      return c.json({ error: "Failed to create agent" }, 400);
    }
  });

  agentsRoutes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const updates: string[] = [];
    const params: SqlParam[] = [];

    if ("name" in body) {
      if (!isNonEmptyString(body.name)) {
        return c.json({ error: "name must be a non-empty string" }, 400);
      }
      updates.push("name = ?");
      params.push(body.name.trim());
    }

    if ("type" in body) {
      if (!isNonEmptyString(body.type)) {
        return c.json({ error: "type must be a non-empty string" }, 400);
      }
      updates.push("type = ?");
      params.push(body.type.trim());
    }

    if ("command_template" in body) {
      if (!isNonEmptyString(body.command_template)) {
        return c.json({ error: "command_template must be a non-empty string" }, 400);
      }
      updates.push("command_template = ?");
      params.push(body.command_template.trim());
    }

    if ("active" in body) {
      if (body.active !== 0 && body.active !== 1) {
        return c.json({ error: "active must be 0 or 1" }, 400);
      }
      updates.push("active = ?");
      params.push(body.active);
    }

    if ("heartbeat_cron" in body) {
      if (body.heartbeat_cron !== null && !isNonEmptyString(body.heartbeat_cron)) {
        return c.json({ error: "heartbeat_cron must be a non-empty string or null" }, 400);
      }
      updates.push("heartbeat_cron = ?");
      params.push(optionalText(body.heartbeat_cron));
    }

    if ("heartbeat_prompt" in body) {
      if (body.heartbeat_prompt !== null && body.heartbeat_prompt !== undefined && typeof body.heartbeat_prompt !== "string") {
        return c.json({ error: "heartbeat_prompt must be a string or null" }, 400);
      }
      updates.push("heartbeat_prompt = ?");
      params.push(optionalText(body.heartbeat_prompt));
    }

    if ("heartbeat_repo" in body) {
      if (body.heartbeat_repo !== null && body.heartbeat_repo !== undefined && typeof body.heartbeat_repo !== "string") {
        return c.json({ error: "heartbeat_repo must be a string or null" }, 400);
      }
      updates.push("heartbeat_repo = ?");
      params.push(optionalText(body.heartbeat_repo));
    }

    if ("heartbeat_enabled" in body) {
      if (body.heartbeat_enabled !== 0 && body.heartbeat_enabled !== 1) {
        return c.json({ error: "heartbeat_enabled must be 0 or 1" }, 400);
      }
      updates.push("heartbeat_enabled = ?");
      params.push(body.heartbeat_enabled);
    }

    if (updates.length === 0) {
      return c.json({ error: "No valid fields provided" }, 400);
    }

    params.push(id);

    try {
      db.query(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      scheduler?.reload();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent name must be unique" }, 400);
      }
      return c.json({ error: "Failed to update agent" }, 400);
    }

    const updated = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
    return c.json(withNextRun(updated, scheduler));
  });

  agentsRoutes.post("/:id/heartbeat/toggle", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const nextEnabled = existing.heartbeat_enabled === 1 ? 0 : 1;
    db.query("UPDATE agents SET heartbeat_enabled = ? WHERE id = ?").run(nextEnabled, id);
    scheduler?.reload();

    const updated = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
    return c.json(withNextRun(updated, scheduler));
  });

  agentsRoutes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    db.query("DELETE FROM agents WHERE id = ?").run(id);
    scheduler?.reload();
    return c.json({ ok: true });
  });

  return agentsRoutes;
}
