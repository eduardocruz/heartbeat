import { Hono } from "hono";
import { scanGlobalTimeline } from "../../projects/timeline";

export function createTimelineRoutes(): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const daysParam = c.req.query("days");
    let days = 30;
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        days = Math.min(parsed, 90);
      }
    }
    const timeline = scanGlobalTimeline(days);
    return c.json(timeline);
  });

  return routes;
}
