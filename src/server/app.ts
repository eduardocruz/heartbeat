import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../db";
import { Executor } from "../executor";
import type { Scheduler } from "../executor/scheduler";
import type { RuntimeRegistry } from "../executor/runtime";
import { createAgentsRoutes } from "./routes/agents";
import { createApprovalsRoutes } from "./routes/approvals";
import { createExecutorRoutes } from "./routes/executor";
import { createRunsRoutes } from "./routes/runs";
import { createProjectsRoutes } from "./routes/projects";
import { createTasksRoutes } from "./routes/tasks";
import { createTimelineRoutes } from "./routes/timeline";
import { createHeatmapRoutes } from "./routes/heatmap";
import { isApiRequest } from "./http";

import indexHtml from "../web/index.html" with { type: "text" };

const appShellHtml = indexHtml.toString();

type AppOptions = {
  executor?: Executor;
  scheduler?: Scheduler;
  startedAt?: string;
  runtimeRegistry?: RuntimeRegistry;
};

export function createApp(db: Database = getDb(), options: AppOptions | Executor = {}): Hono {
  const app = new Hono();
  const resolvedOptions = options instanceof Executor ? { executor: options } : options;
  const startedAt = resolvedOptions.startedAt ?? new Date().toISOString();

  app.get("/", (c) => c.html(appShellHtml));
  app.get("/agents", (c) => c.html(appShellHtml));
  app.get("/runs", (c) => c.html(appShellHtml));
  app.get("/projects", (c) => c.html(appShellHtml));
  app.get("/timeline", (c) => c.html(appShellHtml));
  app.get("/approvals", (c) => c.html(appShellHtml));

  app.notFound((c) => {
    if (isApiRequest(new URL(c.req.url).pathname)) {
      return c.json({ error: "Route not found" }, 404);
    }

    return c.html(appShellHtml, 404);
  });

  app.onError((error, c) => {
    console.error(error);

    if (isApiRequest(new URL(c.req.url).pathname)) {
      return c.json({ error: "Internal server error" }, 500);
    }

    return c.text("Internal server error", 500);
  });

  app.route("/api/tasks", createTasksRoutes(db));
  app.route("/api/agents", createAgentsRoutes(db, resolvedOptions.scheduler));
  app.route("/api/approvals", createApprovalsRoutes(db));
  app.route("/api/projects", createProjectsRoutes(db));
  app.route("/api/runs", createRunsRoutes(db));
  app.route("/api/timeline", createTimelineRoutes());
  app.route("/api/heatmap", createHeatmapRoutes());
  // Phase 4: Runtimes endpoint
  if (resolvedOptions.runtimeRegistry) {
    const registry = resolvedOptions.runtimeRegistry;
    app.get("/api/runtimes", (c) => {
      return c.json({
        available: registry.list(),
        featureFlags: {
          HB_TIER2_CLAUDE: process.env.HB_TIER2_CLAUDE === "1",
          HB_TIER2_OPENAI: process.env.HB_TIER2_OPENAI === "1",
        },
      });
    });
  }

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
