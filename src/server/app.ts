import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../db";
import { Executor } from "../executor";
import { createAgentsRoutes } from "./routes/agents";
import { createExecutorRoutes } from "./routes/executor";
import { createRunsRoutes } from "./routes/runs";
import { createTasksRoutes } from "./routes/tasks";

const indexHtmlFile = Bun.file(new URL("../web/index.html", import.meta.url));

export function createApp(db: Database = getDb(), executor?: Executor): Hono {
  const app = new Hono();

  app.get("/", async (c) => c.html(await indexHtmlFile.text()));
  app.get("/agents", async (c) => c.html(await indexHtmlFile.text()));

  app.route("/api/tasks", createTasksRoutes(db));
  app.route("/api/agents", createAgentsRoutes(db));
  app.route("/api/runs", createRunsRoutes());
  if (executor) {
    app.route("/api/executor", createExecutorRoutes(executor));
  }

  return app;
}
