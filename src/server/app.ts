import { Database } from "bun:sqlite";
import { extname } from "node:path";
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
import styleguideHtml from "../web/styleguide.html" with { type: "text" };
import appCss from "../web/styles/output.css" with { type: "text" };
import appMainJs from "../web/app/main.js" with { type: "text" };
import appApiClientJs from "../web/app/api-client.js" with { type: "text" };
import appConstantsJs from "../web/app/constants.js" with { type: "text" };
import appRouterJs from "../web/app/router.js" with { type: "text" };
import appUiUtilsJs from "../web/app/ui-utils.js" with { type: "text" };
import appAgentsViewJs from "../web/app/views/agents-view.js" with { type: "text" };
import appApprovalsViewJs from "../web/app/views/approvals-view.js" with { type: "text" };
import appProjectsViewJs from "../web/app/views/projects-view.js" with { type: "text" };
import appRunsViewJs from "../web/app/views/runs-view.js" with { type: "text" };
import appTasksControllerJs from "../web/app/views/tasks-controller.js" with { type: "text" };
import appTimelineViewJs from "../web/app/views/timeline-view.js" with { type: "text" };

const appShellHtml = indexHtml.toString();
const styleguideShellHtml = styleguideHtml.toString();
const appCssText = appCss.toString();
const APP_MODULES: Record<string, string> = {
  "main.js": appMainJs.toString(),
  "api-client.js": appApiClientJs.toString(),
  "constants.js": appConstantsJs.toString(),
  "router.js": appRouterJs.toString(),
  "ui-utils.js": appUiUtilsJs.toString(),
  "views/agents-view.js": appAgentsViewJs.toString(),
  "views/approvals-view.js": appApprovalsViewJs.toString(),
  "views/projects-view.js": appProjectsViewJs.toString(),
  "views/runs-view.js": appRunsViewJs.toString(),
  "views/tasks-controller.js": appTasksControllerJs.toString(),
  "views/timeline-view.js": appTimelineViewJs.toString(),
};

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

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

  app.get("/app.css", (c) => c.body(appCssText, 200, { "Content-Type": "text/css; charset=utf-8" }));
  app.get("/app/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const relativePath = pathname.slice("/app/".length);
    if (!relativePath || relativePath.includes("..")) {
      return c.text("Not found", 404);
    }

    const moduleSource = APP_MODULES[relativePath];
    if (!moduleSource) {
      return c.text("Not found", 404);
    }

    const type = STATIC_CONTENT_TYPES[extname(relativePath).toLowerCase()] || "application/octet-stream";
    return c.body(moduleSource, 200, { "Content-Type": type });
  });

  app.get("/assets/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const relativePath = pathname.slice("/assets/".length);
    if (!relativePath || relativePath.includes("..")) {
      return c.text("Not found", 404);
    }

    const file = Bun.file(new URL(`../web/dist/assets/${relativePath}`, import.meta.url));
    const exists = await file.exists();
    if (!exists) {
      return c.text("Not found", 404);
    }

    const type = STATIC_CONTENT_TYPES[extname(relativePath).toLowerCase()] || "application/octet-stream";
    return new Response(file, { status: 200, headers: { "Content-Type": type } });
  });
  app.get("/styleguide", (c) => c.html(styleguideShellHtml));
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
