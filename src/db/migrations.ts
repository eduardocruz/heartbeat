import { Database } from "bun:sqlite";
import { schema } from "./schema";

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

export function runMigrations(db: Database): void {
  db.exec(schema.tasks);
  db.exec(schema.agents);

  if (!hasColumn(db, "tasks", "timeout_seconds")) {
    db.exec("ALTER TABLE tasks ADD COLUMN timeout_seconds INTEGER");
  }
}
