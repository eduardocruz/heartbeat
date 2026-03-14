import { Database } from "bun:sqlite";
import { Hono } from "hono";
type SqlParam = string | number | bigint | boolean | Uint8Array | null;

type AgentRow = {
  id: string;
  name: string;
  type: string;
  command_template: string;
  active: number;
  created_at: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createAgentsRoutes(db: Database): Hono {
  const agentsRoutes = new Hono();

  agentsRoutes.get("/", (c) => {
    const agents = db.query("SELECT * FROM agents ORDER BY created_at DESC").all() as AgentRow[];
    return c.json(agents);
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

    try {
      const result = db
        .query("INSERT INTO agents (name, type, command_template, active) VALUES (?, ?, ?, ?)")
        .run(body.name.trim(), body.type.trim(), body.command_template.trim(), body.active === 0 ? 0 : 1);

      const created = db.query("SELECT * FROM agents WHERE rowid = ?").get(result.lastInsertRowid) as AgentRow;
      return c.json(created, 201);
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

    if (updates.length === 0) {
      return c.json({ error: "No valid fields provided" }, 400);
    }

    params.push(id);

    try {
      db.query(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent name must be unique" }, 400);
      }
      return c.json({ error: "Failed to update agent" }, 400);
    }

    const updated = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
    return c.json(updated);
  });

  agentsRoutes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    db.query("DELETE FROM agents WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  return agentsRoutes;
}
