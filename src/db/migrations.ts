import { Database } from "bun:sqlite";
import { schema } from "./schema";

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function ensureColumn(db: Database, table: string, column: string, sqlType: string): void {
  if (hasColumn(db, table, column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
}

export function runMigrations(db: Database): void {
  db.exec(schema.tasks);
  db.exec(schema.agents);

  ensureColumn(db, "tasks", "timeout_seconds", "INTEGER");
  ensureColumn(db, "agents", "heartbeat_cron", "TEXT");
  ensureColumn(db, "agents", "heartbeat_prompt", "TEXT");
  ensureColumn(db, "agents", "heartbeat_repo", "TEXT");
  ensureColumn(db, "agents", "heartbeat_enabled", "INTEGER DEFAULT 0");
}
