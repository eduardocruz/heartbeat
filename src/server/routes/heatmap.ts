import { Hono } from "hono";
import { scanActivityHeatmap } from "../../projects/heatmap";

export function createHeatmapRoutes(): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const daysParam = c.req.query("days");
    let days = 90;
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        days = Math.min(parsed, 365);
      }
    }
    const heatmap = scanActivityHeatmap(days);
    return c.json(heatmap);
  });

  return routes;
}
