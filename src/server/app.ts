import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../db";
import { createAgentsRoutes } from "./routes/agents";
import { createRunsRoutes } from "./routes/runs";
import { createTasksRoutes } from "./routes/tasks";

export function createApp(db: Database = getDb()): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html("<h1>HeartBeat v0.1.0</h1>"));

  app.route("/api/tasks", createTasksRoutes(db));
  app.route("/api/agents", createAgentsRoutes(db));
  app.route("/api/runs", createRunsRoutes());

  return app;
}
