import { Hono } from "hono";

export const runsRoutes = new Hono();

runsRoutes.get("/", (c) => c.json({ runs: [] }));
