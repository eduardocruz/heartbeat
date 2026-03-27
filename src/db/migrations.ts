import { Database } from "bun:sqlite";
import { schema } from "./schema";

type Migration = {
  version: number;
  name: string;
  apply: (db: Database) => void;
};

function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function hasTable(db: Database, table: string): boolean {
  const result = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(table) as { name: string } | null;
  return result !== null;
}

function ensureColumn(db: Database, table: string, column: string, sqlType: string): void {
  if (!hasTable(db, table)) {
    return;
  }

  if (hasColumn(db, table, column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
}

function ensureMigrationTable(db: Database): void {
  db.exec(schema.schemaMigrations);
}

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.query("SELECT version FROM schema_migrations ORDER BY version ASC").all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((row) => row.version));
}

function recordMigration(db: Database, migration: Migration): void {
  db.query("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
    migration.version,
    migration.name,
  );
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "bootstrap_core_tables",
    apply(db) {
      db.exec(schema.bootstrap.tasks);
      db.exec(schema.bootstrap.agents);
      db.exec(schema.bootstrap.projects);
    },
  },
  {
    version: 2,
    name: "add_workflow_tables_and_columns",
    apply(db) {
      db.exec(schema.workflow.taskComments);

      ensureColumn(db, "tasks", "timeout_seconds", "INTEGER");
      ensureColumn(db, "tasks", "reviewer", "TEXT");
      ensureColumn(db, "agents", "avatar_url", "TEXT");
      ensureColumn(db, "agents", "soul_md", "TEXT");
      ensureColumn(db, "agents", "role", "TEXT");
      ensureColumn(db, "agents", "description", "TEXT");
    },
  },
  {
    version: 3,
    name: "normalize_task_workflow_statuses",
    apply(db) {
      if (!hasTable(db, "tasks")) {
        return;
      }

      db.query("UPDATE tasks SET status = 'todo' WHERE status IN ('pending', 'assigned')").run();
      db.query("UPDATE tasks SET status = 'in_progress' WHERE status = 'running'").run();
    },
  },
  {
    version: 4,
    name: "add_task_dependencies",
    apply(db) {
      db.exec(schema.workflow.taskDependencies);
    },
  },
  {
    version: 5,
    name: "add_runs_and_agent_projects",
    apply(db) {
      db.exec(schema.execution.runs);
      db.exec(schema.execution.agentProjects);
    },
  },
  {
    version: 6,
    name: "add_governance_approvals_and_budget",
    apply(db) {
      db.exec(schema.governance.approvals);
      ensureColumn(db, "agents", "budget_limit_cents", "INTEGER");
      ensureColumn(db, "runs", "cost_cents", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 7,
    name: "add_policy_config",
    apply(db) {
      db.exec(schema.governance.agentPolicies);
      ensureColumn(db, "tasks", "tool", "TEXT");
    },
  },
  {
    version: 8,
    name: "add_run_events",
    apply(db) {
      db.exec(schema.execution.runEvents);
    },
  },
  {
    version: 9,
    name: "add_tier2_sdk_sessions_and_runtime_config",
    apply(db) {
      db.exec(schema.tier2.sdkSessions);
      ensureColumn(db, "agents", "runtime", "TEXT DEFAULT 'cli'");
      ensureColumn(db, "agents", "model", "TEXT");
      ensureColumn(db, "agents", "tools_json", "TEXT");
      ensureColumn(db, "agents", "disallowed_tools_json", "TEXT");
      ensureColumn(db, "agents", "approval_required_json", "TEXT");
      ensureColumn(db, "agents", "max_budget_usd", "REAL");
      ensureColumn(db, "agents", "resume_enabled", "INTEGER DEFAULT 0");
    },
  },
];

export function runMigrations(db: Database): void {
  ensureMigrationTable(db);

  const appliedVersions = getAppliedVersions(db);

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    db.exec("BEGIN");
    try {
      migration.apply(db);
      recordMigration(db, migration);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
