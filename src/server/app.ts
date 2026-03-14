import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../db";
import { Executor } from "../executor";
import type { Scheduler } from "../executor/scheduler";
import { createAgentsRoutes } from "./routes/agents";
import { createExecutorRoutes } from "./routes/executor";
import { createRunsRoutes } from "./routes/runs";
import { createTasksRoutes } from "./routes/tasks";

const indexHtmlFile = Bun.file(new URL("../web/index.html", import.meta.url));

type AppOptions = {
  executor?: Executor;
  scheduler?: Scheduler;
};

export function createApp(db: Database = getDb(), options: AppOptions = {}): Hono {
  const app = new Hono();

  app.get("/", async (c) => c.html(await indexHtmlFile.text()));
  app.get("/agents", async (c) => c.html(await indexHtmlFile.text()));

  app.route("/api/tasks", createTasksRoutes(db));
  app.route("/api/agents", createAgentsRoutes(db, options.scheduler));
  app.route("/api/runs", createRunsRoutes());
  if (options.executor) {
    app.route("/api/executor", createExecutorRoutes(options.executor));
  }

  return app;
}
