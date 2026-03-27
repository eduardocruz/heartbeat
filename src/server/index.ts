import { createDatabase } from "../db";
import { Executor } from "../executor";
import { Scheduler } from "../executor/scheduler";
import { bootstrapRuntimeRegistry } from "../executor/bootstrap";
import { createApp } from "./app";

type ServerOptions = {
  dbPath?: string;
  port?: number;
};

export type HeartbeatServer = {
  port: number;
  startedAt: string;
  stop: () => void;
};

export function startServer(options: ServerOptions = {}): HeartbeatServer {
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "4400", 10);
  const db = createDatabase(options.dbPath);
  const executor = new Executor(db);
  const scheduler = new Scheduler(db);
  const runtimeRegistry = bootstrapRuntimeRegistry(db);

  executor.start();
  scheduler.start();

  const startedAt = new Date().toISOString();
  const app = createApp(db, {
    executor,
    scheduler,
    startedAt,
    runtimeRegistry,
  });

  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });

  console.log(`HeartBeat server listening on http://localhost:${port}`);

  return {
    port,
    startedAt,
    stop: () => {
      scheduler.stop();
      executor.stop();
      server.stop(true);
      db.close();
    },
  };
}

if (import.meta.main) {
  startServer();
}
