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
  startedAt?: string;
};

export function createApp(db: Database = getDb(), options: AppOptions | Executor = {}): Hono {
  const app = new Hono();
  const resolvedOptions = options instanceof Executor ? { executor: options } : options;
  const startedAt = resolvedOptions.startedAt ?? new Date().toISOString();

  app.get("/", async (c) => c.html(await indexHtmlFile.text()));
  app.get("/agents", async (c) => c.html(await indexHtmlFile.text()));

  app.route("/api/tasks", createTasksRoutes(db));
  app.route("/api/agents", createAgentsRoutes(db, resolvedOptions.scheduler));
  app.route("/api/runs", createRunsRoutes());
  if (resolvedOptions.executor) {
    app.route(
      "/api/executor",
      createExecutorRoutes(resolvedOptions.executor, {
        startedAt,
        schedulerStatus: () => {
          if (!resolvedOptions.scheduler) {
            return {
              totalSchedules: 0,
              nextRuns: [],
            };
          }

          return resolvedOptions.scheduler.getStatus();
        },
      }),
    );
  }

  return app;
}
