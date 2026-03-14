import { getDb } from "../db";
import { Executor } from "../executor";
import { createApp } from "./app";

const db = getDb();
const executor = new Executor(db);
executor.start();

const app = createApp(db, executor);
const port = 4400;

console.log(`HeartBeat server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
