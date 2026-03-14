import { getDb } from "../db";
import { createApp } from "./app";

getDb();
const app = createApp();
const port = 4400;

console.log(`HeartBeat server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
