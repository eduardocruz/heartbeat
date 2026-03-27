import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createDatabase, getDefaultDbPath } from "../src/db";
import { Executor } from "../src/executor";
import { Scheduler } from "../src/executor/scheduler";
import { createApp } from "../src/server/app";

const cleanupPaths: string[] = [];

function sh(command: string, cwd?: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("database and task API", () => {
  test("creates database at ~/.heartbeat/heartbeat.db when no override is set", () => {
    const prevDbPath = process.env.HEARTBEAT_DB_PATH;
    const prevHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "heartbeat-home-"));
    cleanupPaths.push(tempHome);

    delete process.env.HEARTBEAT_DB_PATH;
    process.env.HOME = tempHome;

    const expectedPath = join(tempHome, ".heartbeat", "heartbeat.db");
    expect(getDefaultDbPath()).toBe(expectedPath);

    const db = createDatabase();
    db.close();

    expect(existsSync(expectedPath)).toBe(true);

    if (prevDbPath === undefined) {
      delete process.env.HEARTBEAT_DB_PATH;
    } else {
      process.env.HEARTBEAT_DB_PATH = prevDbPath;
    }

    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
  });

  test("migrates a legacy on-disk database in place and records versions once", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "heartbeat-db-upgrade-"));
    cleanupPaths.push(tempDir);

    const dbPath = join(tempDir, "heartbeat.db");
    const legacyDb = new Database(dbPath, { create: true });
    legacyDb.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
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

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
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
    `);
    legacyDb
      .query("INSERT INTO tasks (id, title, status, agent) VALUES (?, ?, ?, ?)")
      .run("legacy-todo", "Legacy todo", "pending", "codex");
    legacyDb
      .query("INSERT INTO tasks (id, title, status, agent) VALUES (?, ?, ?, ?)")
      .run("legacy-running", "Legacy running", "running", "codex");
    legacyDb.close();

    const migratedDb = createDatabase(dbPath);
    const migrationRows = migratedDb
      .query("SELECT version, name FROM schema_migrations ORDER BY version ASC")
      .all() as Array<{ version: number; name: string }>;
    expect(migrationRows).toEqual([
      { version: 1, name: "bootstrap_core_tables" },
      { version: 2, name: "add_workflow_tables_and_columns" },
      { version: 3, name: "normalize_task_workflow_statuses" },
      { version: 4, name: "add_task_dependencies" },
      { version: 5, name: "add_runs_and_agent_projects" },
      { version: 6, name: "add_governance_approvals_and_budget" },
    ]);

    const taskStatuses = migratedDb
      .query("SELECT id, status FROM tasks ORDER BY id ASC")
      .all() as Array<{ id: string; status: string }>;
    expect(taskStatuses).toEqual([
      { id: "legacy-running", status: "in_progress" },
      { id: "legacy-todo", status: "todo" },
    ]);

    const taskColumns = migratedDb.query("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    expect(taskColumns.some((column) => column.name === "reviewer")).toBe(true);
    expect(taskColumns.some((column) => column.name === "timeout_seconds")).toBe(true);

    const agentColumns = migratedDb.query("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
    expect(agentColumns.some((column) => column.name === "avatar_url")).toBe(true);
    expect(agentColumns.some((column) => column.name === "soul_md")).toBe(true);
    expect(agentColumns.some((column) => column.name === "role")).toBe(true);
    expect(agentColumns.some((column) => column.name === "description")).toBe(true);

    const taskCommentsTable = migratedDb
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_comments'")
      .get() as { name: string } | null;
    expect(taskCommentsTable?.name).toBe("task_comments");
    const taskDependenciesTable = migratedDb
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'")
      .get() as { name: string } | null;
    expect(taskDependenciesTable?.name).toBe("task_dependencies");
    migratedDb.close();

    const reopenedDb = createDatabase(dbPath);
    const migrationCount = reopenedDb.query("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
      count: number;
    };
    expect(migrationCount.count).toBe(6);
    reopenedDb.close();
  });

  test("supports workflow task flows, review handoff, and comments", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Implement CRUD",
        description: "Build API",
        priority: "high",
        agent: "codex",
        repo_url: "https://github.com/eduardocruz/heartbeat",
      }),
    });

    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as { id: string; status: string };
    expect(typeof created.id).toBe("string");
    expect(created.status).toBe("todo");

    const listResp = await app.request("/api/tasks");
    expect(listResp.status).toBe(200);
    const list = (await listResp.json()) as Array<{ id: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);

    const filterResp = await app.request("/api/tasks?status=todo");
    expect(filterResp.status).toBe(200);
    const filtered = (await filterResp.json()) as Array<{ id: string }>;
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.id).toBe(created.id);

    const getResp = await app.request(`/api/tasks/${created.id}`);
    expect(getResp.status).toBe(200);

    const beforeUpdate = (await getResp.json()) as { updated_at: string };
    const invalidTransitionResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });

    expect(invalidTransitionResp.status).toBe(400);

    const progressResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", comment: "Started implementation" }),
    });

    expect(progressResp.status).toBe(200);

    const patchResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "in_review",
        reviewer: "ceo",
        comment: "Ready for review",
      }),
    });

    expect(patchResp.status).toBe(200);
    const updated = (await patchResp.json()) as { status: string; reviewer: string | null; updated_at: string };
    expect(updated.status).toBe("in_review");
    expect(updated.reviewer).toBe("ceo");
    expect(updated.updated_at >= beforeUpdate.updated_at).toBe(true);

    const commentsResp = await app.request(`/api/tasks/${created.id}/comments`);
    expect(commentsResp.status).toBe(200);
    const comments = (await commentsResp.json()) as Array<{ body: string; status: string | null; reviewer: string | null }>;
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      body: "Started implementation",
      status: "in_progress",
      reviewer: null,
    });
    expect(comments[1]).toMatchObject({
      body: "Ready for review",
      status: "in_review",
      reviewer: "ceo",
    });

    db.close();
  });

  test("allows assignee-only task reassignment without changing workflow status", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Reassign ownership",
        description: "Move this task to another agent",
        priority: "high",
        agent: "codex",
      }),
    });

    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as { id: string; status: string; agent: string | null };
    expect(created.status).toBe("todo");
    expect(created.agent).toBe("codex");

    const reassignResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "claude" }),
    });

    expect(reassignResp.status).toBe(200);
    const reassigned = (await reassignResp.json()) as { status: string; agent: string | null };
    expect(reassigned.status).toBe("todo");
    expect(reassigned.agent).toBe("claude");

    const commentsResp = await app.request(`/api/tasks/${created.id}/comments`);
    expect(commentsResp.status).toBe(200);
    const comments = (await commentsResp.json()) as Array<{ body: string }>;
    expect(comments).toHaveLength(0);

    db.close();
  });

  test("rejects note-only workflow drift and terminal task cancellation", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Review fix",
        agent: "codex",
      }),
    });

    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as { id: string };

    const startResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", comment: "Started work" }),
    });
    expect(startResp.status).toBe(200);

    const invalidReviewNoteResp = await app.request(`/api/tasks/${created.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: "Pretending this is ready for review",
        status: "in_review",
      }),
    });
    expect(invalidReviewNoteResp.status).toBe(400);

    const reviewResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "in_review",
        reviewer: "ceo",
        comment: "Ready for review",
      }),
    });
    expect(reviewResp.status).toBe(200);

    const mismatchedReviewerNoteResp = await app.request(`/api/tasks/${created.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: "Wrong reviewer on note",
        reviewer: "cto",
      }),
    });
    expect(mismatchedReviewerNoteResp.status).toBe(400);

    const doneResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", comment: "Approved" }),
    });
    expect(doneResp.status).toBe(200);

    const cancelDoneResp = await app.request(`/api/tasks/${created.id}`, {
      method: "DELETE",
    });
    expect(cancelDoneResp.status).toBe(400);

    db.close();
  });

  test("maintains lifecycle timestamps when task status changes manually", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Track lifecycle",
        agent: "codex",
      }),
    });

    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as { id: string; started_at: string | null; completed_at: string | null };
    expect(created.started_at).toBeNull();
    expect(created.completed_at).toBeNull();

    const startResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", comment: "Start work" }),
    });
    expect(startResp.status).toBe(200);
    const started = (await startResp.json()) as { started_at: string | null; completed_at: string | null };
    expect(typeof started.started_at).toBe("string");
    expect(started.completed_at).toBeNull();

    const reviewResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "in_review",
        reviewer: "ceo",
        comment: "Ready for review",
      }),
    });
    expect(reviewResp.status).toBe(200);
    const inReview = (await reviewResp.json()) as { started_at: string | null; completed_at: string | null };
    expect(inReview.started_at).toBe(started.started_at);
    expect(inReview.completed_at).toBeNull();

    const doneResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", comment: "Approved" }),
    });
    expect(doneResp.status).toBe(200);
    const done = (await doneResp.json()) as { started_at: string | null; completed_at: string | null };
    expect(done.started_at).toBe(started.started_at);
    expect(typeof done.completed_at).toBe("string");

    db.close();
  });

  test("tracks blockers explicitly and resumes blocked tasks once all blockers resolve", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createTask = async (payload: Record<string, unknown>) => {
      const resp = await app.request("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(resp.status).toBe(201);
      return resp.json();
    };

    const blockerOne = (await createTask({ title: "Blocker one", agent: "codex" })) as { id: string };
    const blockerTwo = (await createTask({ title: "Blocker two", agent: "codex" })) as { id: string };
    const dependent = (await createTask({
      title: "Dependent",
      agent: "codex",
      status: "blocked",
      blocked_by_task_ids: [blockerOne.id, blockerTwo.id],
    })) as { id: string; blocked_by_task_ids: string[] };

    expect(dependent.blocked_by_task_ids).toEqual([blockerOne.id, blockerTwo.id]);

    const firstResolvedResp = await app.request(`/api/tasks/${blockerOne.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", comment: "Start blocker one" }),
    });
    expect(firstResolvedResp.status).toBe(200);

    const firstDoneResp = await app.request(`/api/tasks/${blockerOne.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", comment: "Finish blocker one" }),
    });
    expect(firstDoneResp.status).toBe(200);

    const blockedStillResp = await app.request(`/api/tasks/${dependent.id}`);
    const blockedStill = (await blockedStillResp.json()) as { status: string };
    expect(blockedStill.status).toBe("blocked");

    const secondStartResp = await app.request(`/api/tasks/${blockerTwo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", comment: "Start blocker two" }),
    });
    expect(secondStartResp.status).toBe(200);

    const secondDoneResp = await app.request(`/api/tasks/${blockerTwo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", comment: "Finish blocker two" }),
    });
    expect(secondDoneResp.status).toBe(200);

    const resumedResp = await app.request(`/api/tasks/${dependent.id}`);
    expect(resumedResp.status).toBe(200);
    const resumed = (await resumedResp.json()) as { status: string; blocked_by_task_ids: string[] };
    expect(resumed.status).toBe("todo");
    expect(resumed.blocked_by_task_ids).toEqual([blockerOne.id, blockerTwo.id]);

    const commentsResp = await app.request(`/api/tasks/${dependent.id}/comments`);
    expect(commentsResp.status).toBe(200);
    const comments = (await commentsResp.json()) as Array<{ body: string; status: string | null }>;
    expect(comments).toHaveLength(1);
    expect(comments[0]?.status).toBe("todo");
    expect(comments[0]?.body).toContain(blockerOne.id);
    expect(comments[0]?.body).toContain(blockerTwo.id);

    const noOpResp = await app.request(`/api/tasks/${blockerTwo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Metadata change only" }),
    });
    expect(noOpResp.status).toBe(200);

    const commentsAfterNoOpResp = await app.request(`/api/tasks/${dependent.id}/comments`);
    const commentsAfterNoOp = (await commentsAfterNoOpResp.json()) as Array<{ body: string }>;
    expect(commentsAfterNoOp).toHaveLength(1);

    db.close();
  });

  test("rejects invalid API query params and non-object JSON bodies", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const invalidLimitResp = await app.request("/api/tasks?limit=501");
    expect(invalidLimitResp.status).toBe(400);

    const malformedLimitResp = await app.request("/api/tasks?limit=10foo");
    expect(malformedLimitResp.status).toBe(400);

    const invalidTimelineResp = await app.request("/api/timeline?days=0");
    expect(invalidTimelineResp.status).toBe(400);

    const malformedTimelineResp = await app.request("/api/timeline?days=5abc");
    expect(malformedTimelineResp.status).toBe(400);

    const invalidHeatmapResp = await app.request("/api/heatmap?days=366");
    expect(invalidHeatmapResp.status).toBe(400);

    const invalidProjectResp = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Heartbeat", path: "/tmp/project", description: 123 }),
    });
    expect(invalidProjectResp.status).toBe(400);

    const arrayBodyResp = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    expect(arrayBodyResp.status).toBe(400);

    db.close();
  });

  test("returns JSON errors for missing API routes", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const resp = await app.request("/api/does-not-exist");
    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: "Route not found" });

    db.close();
  });

  test("executes tasks sequentially and reports executor status", async () => {
    const db = createDatabase(":memory:");
    const executor = new Executor(db);
    const app = createApp(db, { executor });

    const createAgent = async (name: string, commandTemplate: string) => {
      const resp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: "custom",
          command_template: commandTemplate,
        }),
      });
      expect(resp.status).toBe(201);
    };

    await createAgent("echo-agent", "echo hello");
    await createAgent("timeout-agent", "sleep 2");
    await createAgent("invalid-agent", "definitely-not-a-command");
    await createAgent("git-agent", "pwd");

    const createTask = async (payload: Record<string, unknown>) => {
      const resp = await app.request("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(resp.status).toBe(201);
      return resp.json();
    };

    const doneTask = (await createTask({
      title: "Echo",
      agent: "echo-agent",
      timeout_seconds: 10,
    })) as { id: string };

    const timeoutTask = (await createTask({
      title: "Sleep",
      agent: "timeout-agent",
      timeout_seconds: 1,
    })) as { id: string };

    const invalidTask = (await createTask({
      title: "Invalid",
      agent: "invalid-agent",
      timeout_seconds: 10,
    })) as { id: string };

    const sourceRepo = mkdtempSync(join(tmpdir(), "heartbeat-source-repo-"));
    cleanupPaths.push(sourceRepo);
    sh("git init --initial-branch=main", sourceRepo);
    writeFileSync(join(sourceRepo, "README.md"), "heartbeat\n");
    sh("git add README.md", sourceRepo);
    sh("git -c user.name='Test User' -c user.email='test@example.com' commit -m 'init'", sourceRepo);
    const repoHead = sh("git rev-parse HEAD", sourceRepo);

    const gitTask = (await createTask({
      title: "Git",
      agent: "git-agent",
      repo_url: sourceRepo,
      timeout_seconds: 10,
    })) as { id: string };

    const missingRepoTask = (await createTask({
      title: "Missing repo",
      agent: "git-agent",
      repo_url: join(sourceRepo, "does-not-exist"),
      timeout_seconds: 10,
    })) as { id: string };

    const statusBeforeResp = await app.request("/api/executor/status");
    expect(statusBeforeResp.status).toBe(200);
    const statusBefore = (await statusBeforeResp.json()) as { queueLength: number; runningTasks: number };
    expect(statusBefore.queueLength).toBe(5);
    expect(statusBefore.runningTasks).toBe(0);

    await executor.checkForWork();

    const doneResp = await app.request(`/api/tasks/${doneTask.id}`);
    const done = (await doneResp.json()) as { status: string; stdout: string };
    expect(done.status).toBe("done");
    expect(done.stdout).toBe("hello\n");

    const timeoutResp = await app.request(`/api/tasks/${timeoutTask.id}`);
    const timeout = (await timeoutResp.json()) as { status: string; stderr: string };
    expect(timeout.status).toBe("failed");
    expect(timeout.stderr).toContain("timeout after 1s");

    const invalidResp = await app.request(`/api/tasks/${invalidTask.id}`);
    const invalid = (await invalidResp.json()) as { status: string; stderr: string };
    expect(invalid.status).toBe("failed");
    expect(typeof invalid.stderr).toBe("string");
    expect(invalid.stderr.length).toBeGreaterThan(0);

    const gitResp = await app.request(`/api/tasks/${gitTask.id}`);
    const gitDone = (await gitResp.json()) as { status: string; stdout: string; commit_hash: string };
    expect(gitDone.status).toBe("done");
    expect(gitDone.stdout).toContain(`${join(process.env.HOME ?? "", ".heartbeat", "workspaces", gitTask.id)}`);
    expect(gitDone.commit_hash).toBe(repoHead);

    const missingRepoResp = await app.request(`/api/tasks/${missingRepoTask.id}`);
    const missingRepo = (await missingRepoResp.json()) as { status: string; stderr: string };
    expect(missingRepo.status).toBe("failed");
    expect(String(missingRepo.stderr)).toContain("workspace setup failed");

    const statusAfterResp = await app.request("/api/executor/status");
    const statusAfter = (await statusAfterResp.json()) as {
      queueLength: number;
      runningTasks: number;
      lastPollAt: string | null;
    };

    expect(statusAfter.queueLength).toBe(0);
    expect(statusAfter.runningTasks).toBe(0);
    expect(typeof statusAfter.lastPollAt).toBe("string");

    db.close();
  });

  test("executor resumes blocked dependents when blocker task completes", async () => {
    const db = createDatabase(":memory:");
    const executor = new Executor(db);
    const app = createApp(db, { executor });

    const createAgentResp = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "echo-agent",
        type: "custom",
        command_template: "echo hello",
      }),
    });
    expect(createAgentResp.status).toBe(201);

    const createTask = async (payload: Record<string, unknown>) => {
      const resp = await app.request("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(resp.status).toBe(201);
      return resp.json();
    };

    const blocker = (await createTask({
      title: "Blocker",
      agent: "echo-agent",
      timeout_seconds: 10,
    })) as { id: string };

    const dependent = (await createTask({
      title: "Dependent",
      agent: "echo-agent",
      status: "blocked",
      timeout_seconds: 10,
      blocked_by_task_ids: [blocker.id],
    })) as { id: string };

    await executor.checkForWork();

    const blockerResp = await app.request(`/api/tasks/${blocker.id}`);
    const blockerDone = (await blockerResp.json()) as { status: string };
    expect(blockerDone.status).toBe("done");

    const dependentResp = await app.request(`/api/tasks/${dependent.id}`);
    const dependentDone = (await dependentResp.json()) as { status: string; stdout: string };
    expect(dependentDone.status).toBe("done");
    expect(dependentDone.stdout).toBe("hello\n");

    const commentsResp = await app.request(`/api/tasks/${dependent.id}/comments`);
    const comments = (await commentsResp.json()) as Array<{ body: string; status: string | null }>;
    expect(comments).toHaveLength(1);
    expect(comments[0]?.status).toBe("todo");
    expect(comments[0]?.body).toContain(blocker.id);

    db.close();
  });

  test("executor skips tasks with no agent assigned without failing them", async () => {
    const db = createDatabase(":memory:");
    const executor = new Executor(db);
    const app = createApp(db, { executor });

    const createAgentResp = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "echo-agent",
        type: "custom",
        command_template: "echo hello",
      }),
    });
    expect(createAgentResp.status).toBe(201);

    // Create a task with no agent
    const unassignedResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Unassigned task",
        timeout_seconds: 10,
      }),
    });
    expect(unassignedResp.status).toBe(201);
    const unassigned = (await unassignedResp.json()) as { id: string; status: string };
    expect(unassigned.status).toBe("todo");

    // Create a task with an agent — should run
    const assignedResp = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Assigned task",
        agent: "echo-agent",
        timeout_seconds: 10,
      }),
    });
    expect(assignedResp.status).toBe(201);
    const assigned = (await assignedResp.json()) as { id: string; status: string };

    await executor.checkForWork();

    // Unassigned task should remain todo (not failed)
    const unassignedAfterResp = await app.request(`/api/tasks/${unassigned.id}`);
    const unassignedAfter = (await unassignedAfterResp.json()) as { status: string };
    expect(unassignedAfter.status).toBe("todo");

    // Assigned task should have run to completion
    const assignedAfterResp = await app.request(`/api/tasks/${assigned.id}`);
    const assignedAfter = (await assignedAfterResp.json()) as { status: string; stdout: string };
    expect(assignedAfter.status).toBe("done");
    expect(assignedAfter.stdout).toBe("hello\n");

    // Now assign an agent to the previously unassigned task
    const patchResp = await app.request(`/api/tasks/${unassigned.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "echo-agent" }),
    });
    expect(patchResp.status).toBe(200);

    await executor.checkForWork();

    const nowAssignedResp = await app.request(`/api/tasks/${unassigned.id}`);
    const nowAssigned = (await nowAssignedResp.json()) as { status: string; stdout: string };
    expect(nowAssigned.status).toBe("done");
    expect(nowAssigned.stdout).toBe("hello\n");

    db.close();
  });

  test("supports heartbeat fields and toggle API for agents", async () => {
    const db = createDatabase(":memory:");
    const scheduler = new Scheduler(db);
    scheduler.start();
    const app = createApp(db, { scheduler });

    const createResp = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "cto",
        type: "codex",
        command_template: "echo {prompt}",
        heartbeat_cron: "*/5 * * * * *",
        heartbeat_prompt: "Daily heartbeat",
        heartbeat_repo: "https://github.com/eduardocruz/heartbeat",
        heartbeat_enabled: 1,
      }),
    });

    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as {
      id: string;
      heartbeat_enabled: number;
      heartbeat_next_run: string | null;
    };

    expect(created.heartbeat_enabled).toBe(1);
    expect(created.heartbeat_next_run).not.toBeNull();

    const toggleResp = await app.request(`/api/agents/${created.id}/heartbeat/toggle`, {
      method: "POST",
    });

    expect(toggleResp.status).toBe(200);
    const toggled = (await toggleResp.json()) as {
      heartbeat_enabled: number;
      heartbeat_next_run: string | null;
    };

    expect(toggled.heartbeat_enabled).toBe(0);
    expect(toggled.heartbeat_next_run).toBeNull();

    scheduler.stop();
    db.close();
  });

  test("returns agent details with assigned issues", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const createAgentResp = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "codex",
        type: "custom",
        command_template: "echo hello",
      }),
    });
    expect(createAgentResp.status).toBe(201);
    const agent = (await createAgentResp.json()) as { id: string; name: string };

    const createTask = async (payload: Record<string, unknown>) => {
      const resp = await app.request("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(resp.status).toBe(201);
      return resp.json();
    };

    const firstTask = (await createTask({
      title: "First task",
      agent: "codex",
      status: "todo",
    })) as { id: string };

    const secondTask = (await createTask({
      title: "Second task",
      agent: "codex",
      status: "in_progress",
    })) as { id: string };

    await createTask({
      title: "Unassigned task",
      status: "todo",
    });

    const resp = await app.request(`/api/agents/${agent.id}`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      id: string;
      name: string;
      assigned_issues: Array<{ id: string; title: string; status: string }>;
    };

    expect(body.id).toBe(agent.id);
    expect(body.name).toBe("codex");
    expect(body.assigned_issues).toEqual([
      expect.objectContaining({ id: firstTask.id, title: "First task", status: "todo" }),
      expect.objectContaining({ id: secondTask.id, title: "Second task", status: "in_progress" }),
    ]);

    const missingResp = await app.request("/api/agents/does-not-exist");
    expect(missingResp.status).toBe(404);

    db.close();
  });

  test("scheduler creates heartbeat tasks and prevents overlap", async () => {
    const db = createDatabase(":memory:");

    db.query(
      "INSERT INTO agents (name, type, command_template, heartbeat_cron, heartbeat_prompt, heartbeat_repo, heartbeat_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "cto",
      "codex",
      "echo {prompt}",
      "*/5 * * * * *",
      "Run heartbeat",
      "https://github.com/eduardocruz/heartbeat",
      1,
    );

    const agent = db.query("SELECT id FROM agents WHERE name = ?").get("cto") as { id: string };

    const scheduler = new Scheduler(db);
    scheduler.start();

    const firstResult = await scheduler.triggerAgent(agent.id);
    expect(firstResult).toBe("created");

    const firstTask = db
      .query("SELECT id, title, status FROM tasks WHERE agent = ? ORDER BY created_at DESC LIMIT 1")
      .get("cto") as { id: string; title: string; status: string };

    expect(firstTask.title).toBe("[heartbeat] cto");
    expect(firstTask.status).toBe("todo");

    db.query("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(firstTask.id);

    const secondResult = await scheduler.triggerAgent(agent.id);
    expect(secondResult).toBe("skipped_running");

    const total = db.query("SELECT COUNT(*) AS count FROM tasks WHERE agent = ?").get("cto") as { count: number };
    expect(total.count).toBe(1);

    scheduler.stop();
    db.close();
  });

  test("runs API returns execution history", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    // Insert a task and a run manually
    db.query("INSERT INTO tasks (id, title, status, agent) VALUES (?, ?, ?, ?)").run("t1", "Test task", "done", "bot");
    db.query("INSERT INTO runs (id, task_id, agent, status, exit_code, started_at, completed_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))").run("r1", "t1", "bot", "done", 0);

    const listRes = await app.request("/api/runs");
    expect(listRes.status).toBe(200);
    const runs = (await listRes.json()) as Array<{ id: string; task_title: string }>;
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe("r1");
    expect(runs[0].task_title).toBe("Test task");

    const getRes = await app.request("/api/runs/r1");
    expect(getRes.status).toBe(200);
    const run = (await getRes.json()) as { id: string; agent: string };
    expect(run.id).toBe("r1");
    expect(run.agent).toBe("bot");

    const notFound = await app.request("/api/runs/nonexistent");
    expect(notFound.status).toBe(404);

    db.close();
  });

  test("task retry requeues failed tasks", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    // Create a failed task
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Retry me", agent: "bot" }),
    });
    const task = (await createRes.json()) as { id: string };

    // Move to in_progress then failed
    await app.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    await app.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed" }),
    });

    // Retry
    const retryRes = await app.request(`/api/tasks/${task.id}/retry`, { method: "POST" });
    expect(retryRes.status).toBe(200);
    const retried = (await retryRes.json()) as { id: string; status: string };
    expect(retried.status).toBe("todo");

    // Cannot retry a todo task
    const badRetry = await app.request(`/api/tasks/${task.id}/retry`, { method: "POST" });
    expect(badRetry.status).toBe(400);

    db.close();
  });

  test("agent-project relationships CRUD", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    // Create an agent
    const agentRes = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "worker", type: "claude", command_template: "echo hi" }),
    });
    const agent = (await agentRes.json()) as { id: string };

    // Create a project
    const projectRes = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "myproj", path: "/tmp/myproj" }),
    });
    const project = (await projectRes.json()) as { id: string };

    // Link agent to project
    const linkRes = await app.request(`/api/agents/${agent.id}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id, role: "lead" }),
    });
    expect(linkRes.status).toBe(201);

    // List agent projects
    const listRes = await app.request(`/api/agents/${agent.id}/projects`);
    expect(listRes.status).toBe(200);
    const projects = (await listRes.json()) as Array<{ name: string; agent_role: string }>;
    expect(projects.length).toBe(1);
    expect(projects[0].name).toBe("myproj");
    expect(projects[0].agent_role).toBe("lead");

    // Delete the link
    const delRes = await app.request(`/api/agents/${agent.id}/projects/${project.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const emptyList = await app.request(`/api/agents/${agent.id}/projects`);
    const emptyProjects = (await emptyList.json()) as Array<unknown>;
    expect(emptyProjects.length).toBe(0);

    db.close();
  });

  describe("approvals API", () => {
    test("GET /api/approvals returns empty list when no approvals exist", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const resp = await app.request("/api/approvals");
      expect(resp.status).toBe(200);
      const list = (await resp.json()) as Array<unknown>;
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(0);

      db.close();
    });

    test("POST /api/approvals creates an approval with pending status", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      expect(createAgentResp.status).toBe(201);
      const agent = (await createAgentResp.json()) as { id: string };

      const createResp = await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agent.id,
          reason: "Budget limit reached",
        }),
      });
      expect(createResp.status).toBe(201);
      const approval = (await createResp.json()) as {
        id: string;
        agent_id: string;
        status: string;
        reason: string;
        run_id: string | null;
        resolved_at: string | null;
      };
      expect(typeof approval.id).toBe("string");
      expect(approval.agent_id).toBe(agent.id);
      expect(approval.status).toBe("pending");
      expect(approval.reason).toBe("Budget limit reached");
      expect(approval.run_id).toBeNull();
      expect(approval.resolved_at).toBeNull();

      db.close();
    });

    test("POST /api/approvals validates required fields", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const resp = await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "missing agent_id" }),
      });
      expect(resp.status).toBe(400);

      db.close();
    });

    test("PATCH /api/approvals/:id approves a pending approval", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      const agent = (await createAgentResp.json()) as { id: string };

      const createResp = await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, reason: "Budget exceeded" }),
      });
      const approval = (await createResp.json()) as { id: string; status: string };
      expect(approval.status).toBe("pending");

      const patchResp = await app.request(`/api/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", resolved_by: "admin" }),
      });
      expect(patchResp.status).toBe(200);
      const updated = (await patchResp.json()) as { status: string; resolved_by: string; resolved_at: string };
      expect(updated.status).toBe("approved");
      expect(updated.resolved_by).toBe("admin");
      expect(typeof updated.resolved_at).toBe("string");

      db.close();
    });

    test("PATCH /api/approvals/:id denies a pending approval", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      const agent = (await createAgentResp.json()) as { id: string };

      const createResp = await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, reason: "Suspicious operation" }),
      });
      const approval = (await createResp.json()) as { id: string };

      const patchResp = await app.request(`/api/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "denied" }),
      });
      expect(patchResp.status).toBe(200);
      const updated = (await patchResp.json()) as { status: string };
      expect(updated.status).toBe("denied");

      db.close();
    });

    test("PATCH /api/approvals/:id rejects invalid status values", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      const agent = (await createAgentResp.json()) as { id: string };

      const createResp = await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, reason: "Budget exceeded" }),
      });
      const approval = (await createResp.json()) as { id: string };

      const patchResp = await app.request(`/api/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "hacked" }),
      });
      expect(patchResp.status).toBe(400);

      db.close();
    });

    test("GET /api/approvals filters by status", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      const agent = (await createAgentResp.json()) as { id: string };

      // Create two approvals
      const resp1 = await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, reason: "First" }),
      });
      const approval1 = (await resp1.json()) as { id: string };

      await app.request("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, reason: "Second" }),
      });

      // Approve first
      await app.request(`/api/approvals/${approval1.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });

      const pendingResp = await app.request("/api/approvals?status=pending");
      const pending = (await pendingResp.json()) as Array<unknown>;
      expect(pending.length).toBe(1);

      const approvedResp = await app.request("/api/approvals?status=approved");
      const approved = (await approvedResp.json()) as Array<unknown>;
      expect(approved.length).toBe(1);

      db.close();
    });
  });

  describe("agent budget tracking", () => {
    test("GET /api/agents/:id/budget returns budget info with no limit set", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      const agent = (await createAgentResp.json()) as { id: string };

      const budgetResp = await app.request(`/api/agents/${agent.id}/budget`);
      expect(budgetResp.status).toBe(200);
      const budget = (await budgetResp.json()) as {
        budget_limit_cents: number | null;
        spent_cents: number;
        remaining_cents: number | null;
      };
      expect(budget.budget_limit_cents).toBeNull();
      expect(budget.spent_cents).toBe(0);
      expect(budget.remaining_cents).toBeNull();

      db.close();
    });

    test("PATCH /api/agents/:id sets budget_limit_cents", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi" }),
      });
      const agent = (await createAgentResp.json()) as { id: string; budget_limit_cents: number | null };

      const patchResp = await app.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget_limit_cents: 1000 }),
      });
      expect(patchResp.status).toBe(200);
      const updated = (await patchResp.json()) as { budget_limit_cents: number | null };
      expect(updated.budget_limit_cents).toBe(1000);

      db.close();
    });

    test("GET /api/agents/:id/budget calculates spent from completed runs this month", async () => {
      const db = createDatabase(":memory:");
      const app = createApp(db);

      const createAgentResp = await app.request("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "codex", type: "custom", command_template: "echo hi", budget_limit_cents: 500 }),
      });
      const agent = (await createAgentResp.json()) as { id: string };

      // Insert a run with cost directly into the db to simulate spending
      db.query(
        "INSERT INTO runs (id, task_id, agent, status, cost_cents, started_at, completed_at) VALUES (?, ?, ?, 'done', ?, datetime('now'), datetime('now'))",
      ).run("run-1", "task-1", "codex", 200);

      const budgetResp = await app.request(`/api/agents/${agent.id}/budget`);
      expect(budgetResp.status).toBe(200);
      const budget = (await budgetResp.json()) as {
        budget_limit_cents: number | null;
        spent_cents: number;
        remaining_cents: number | null;
      };
      expect(budget.budget_limit_cents).toBe(500);
      expect(budget.spent_cents).toBe(200);
      expect(budget.remaining_cents).toBe(300);

      db.close();
    });

    test("migration 6 adds approvals table, cost_cents to runs, budget_limit_cents to agents", async () => {
      const db = createDatabase(":memory:");

      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("approvals");

      const agentColumns = db.query("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
      expect(agentColumns.some((c) => c.name === "budget_limit_cents")).toBe(true);

      const runColumns = db.query("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      expect(runColumns.some((c) => c.name === "cost_cents")).toBe(true);

      db.close();
    });
  });
});
