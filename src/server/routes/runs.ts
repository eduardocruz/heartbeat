import { Hono } from "hono";

export function createRunsRoutes(): Hono {
  const runsRoutes = new Hono();

  runsRoutes.get("/", (c) => c.json([]));

  return runsRoutes;
}
