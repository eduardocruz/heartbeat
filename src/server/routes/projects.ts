import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { scanClaudeProjects } from "../../projects/scanner";

type ProjectRow = {
  id: string;
  name: string;
  path: string;
  source: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createProjectsRoutes(db: Database): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const projects = db.query("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
    return c.json(projects);
  });

  routes.post("/scan", (c) => {
    const scanned = scanClaudeProjects();
    let inserted = 0;

    const insertStmt = db.query(
      `INSERT OR IGNORE INTO projects (name, path, source) VALUES (?, ?, ?)`,
    );

    for (const project of scanned) {
      const result = insertStmt.run(project.name, project.path, project.source);
      if (result.changes > 0) {
        inserted++;
      }
    }

    const projects = db.query("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
    return c.json({ inserted, total: projects.length, projects });
  });

  routes.post("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isNonEmptyString(body.name)) {
      return c.json({ error: "name is required" }, 400);
    }

    if (!isNonEmptyString(body.path)) {
      return c.json({ error: "path is required" }, 400);
    }

    const description = typeof body.description === "string" ? body.description : null;

    try {
      const result = db
        .query(
          `INSERT INTO projects (name, path, source, description) VALUES (?, ?, 'manual', ?)`,
        )
        .run(body.name.trim(), body.path.trim(), description);

      const created = db.query("SELECT * FROM projects WHERE rowid = ?").get(result.lastInsertRowid) as ProjectRow;
      return c.json(created, 201);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return c.json({ error: "A project with this path already exists" }, 409);
      }
      throw err;
    }
  });

  routes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | null;
    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    db.query("DELETE FROM projects WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  return routes;
}
