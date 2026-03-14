import { Hono } from "hono";
import { Executor } from "../../executor";

type ExecutorRouteOptions = {
  startedAt: string;
  schedulerStatus?: () => {
    totalSchedules: number;
    nextRuns: Array<{ agentId: string; agentName: string; nextRun: string | null }>;
  };
};

export function createExecutorRoutes(executor: Executor, options: ExecutorRouteOptions): Hono {
  const executorRoutes = new Hono();

  executorRoutes.get("/status", (c) => {
    const scheduler = options.schedulerStatus?.() ?? {
      totalSchedules: 0,
      nextRuns: [],
    };

    return c.json({
      ...executor.getStatus(),
      startedAt: options.startedAt,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(options.startedAt)) / 1000)),
      agentHeartbeats: scheduler.totalSchedules,
      scheduler,
    });
  });

  return executorRoutes;
}
