import { Hono } from "hono";

export const tasksRoutes = new Hono();

tasksRoutes.get("/", (c) => c.json({ tasks: [] }));
