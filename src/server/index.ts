import { getDb } from "../db";
import { Executor } from "../executor";
import { Scheduler } from "../executor/scheduler";
import { createApp } from "./app";

const db = getDb();

const executor = new Executor(db);
executor.start();

const scheduler = new Scheduler(db);
scheduler.start();

const app = createApp(db, { executor, scheduler });
const port = 4400;

console.log(`HeartBeat server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
