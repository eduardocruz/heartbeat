import { Hono } from "hono";
import { agentsRoutes } from "./routes/agents";
import { runsRoutes } from "./routes/runs";
import { tasksRoutes } from "./routes/tasks";

const app = new Hono();

app.get("/", (c) => c.html("<h1>HeartBeat v0.1.0</h1>"));

app.route("/api/tasks", tasksRoutes);
app.route("/api/agents", agentsRoutes);
app.route("/api/runs", runsRoutes);

const port = 4400;

console.log(`HeartBeat server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
