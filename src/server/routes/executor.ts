import { Hono } from "hono";
import { Executor } from "../../executor";

export function createExecutorRoutes(executor: Executor): Hono {
  const executorRoutes = new Hono();

  executorRoutes.get("/status", (c) => {
    return c.json(executor.getStatus());
  });

  return executorRoutes;
}
