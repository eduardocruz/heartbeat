import { Database } from "bun:sqlite";
import { schema } from "./schema";

export function runMigrations(db: Database): void {
  db.exec(schema.tasks);
  db.exec(schema.agents);
}
