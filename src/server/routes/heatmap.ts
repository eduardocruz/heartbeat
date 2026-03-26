import { Hono } from "hono";
import { scanActivityHeatmap } from "../../projects/heatmap";
import { parseBoundedPositiveInt } from "../http";

export function createHeatmapRoutes(): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const daysResult = parseBoundedPositiveInt(c.req.query("days"), "days", {
      defaultValue: 90,
      max: 365,
    });
    if (!daysResult.ok) {
      return c.json({ error: daysResult.error }, 400);
    }
    try {
      const heatmap = scanActivityHeatmap(daysResult.value);
      return c.json(heatmap);
    } catch {
      return c.json({ error: "Failed to load heatmap" }, 500);
    }
  });

  return routes;
}
