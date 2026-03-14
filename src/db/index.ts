import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations";

let dbInstance: Database | null = null;

export function getDefaultDbPath(): string {
  if (process.env.HEARTBEAT_DB_PATH) {
    return process.env.HEARTBEAT_DB_PATH;
  }

  return join(process.env.HOME ?? homedir(), ".heartbeat", "heartbeat.db");
}

export function createDatabase(path = getDefaultDbPath()): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, { create: true });
  runMigrations(db);
  return db;
}

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = createDatabase();
  }

  return dbInstance;
}

export function resetDbForTests(): void {
  dbInstance?.close();
  dbInstance = null;
}
