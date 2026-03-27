export const schema = {
  schemaMigrations: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
  bootstrap: {
    tasks: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        agent TEXT,
        repo_url TEXT,
        branch TEXT,
        result_summary TEXT,
        commit_hash TEXT,
        exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    agents: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        command_template TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        heartbeat_cron TEXT,
        heartbeat_prompt TEXT,
        heartbeat_repo TEXT,
        heartbeat_enabled INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    projects: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL DEFAULT 'manual',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  workflow: {
    taskComments: `
      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        task_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT,
        reviewer TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    taskDependencies: `
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        task_id TEXT NOT NULL,
        blocker_task_id TEXT NOT NULL,
        satisfied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(task_id, blocker_task_id)
      );
    `,
  },
  execution: {
    runs: `
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        task_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
        commit_hash TEXT,
        workspace_dir TEXT,
        timed_out INTEGER DEFAULT 0,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    agentProjects: `
      CREATE TABLE IF NOT EXISTS agent_projects (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        role TEXT DEFAULT 'contributor',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(agent_id, project_id)
      );
    `,
    runEvents: `
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
};
