import { Hono } from "hono";
import { scanGlobalTimeline } from "../../projects/timeline";
import { parseBoundedPositiveInt } from "../http";

export function createTimelineRoutes(): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const daysResult = parseBoundedPositiveInt(c.req.query("days"), "days", {
      defaultValue: 30,
      max: 90,
    });
    if (!daysResult.ok) {
      return c.json({ error: daysResult.error }, 400);
    }
    try {
      const timeline = scanGlobalTimeline(daysResult.value);
      return c.json(timeline);
    } catch {
      return c.json({ error: "Failed to load timeline" }, 500);
    }
  });

  return routes;
}
