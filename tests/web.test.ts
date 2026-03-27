import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";

class FakeClassList {
  #classes = new Set<string>();

  add(...names: string[]) {
    for (const name of names) {
      this.#classes.add(name);
    }
  }

  remove(...names: string[]) {
    for (const name of names) {
      this.#classes.delete(name);
    }
  }

  toggle(name: string, force?: boolean) {
    if (force === undefined) {
      if (this.#classes.has(name)) {
        this.#classes.delete(name);
        return false;
      }
      this.#classes.add(name);
      return true;
    }

    if (force) {
      this.#classes.add(name);
      return true;
    }

    this.#classes.delete(name);
    return false;
  }
}

class FakeElement {
  id = "";
  dataset: Record<string, string> = {};
  value = "";
  checked = false;
  onclick: ((event?: any) => any) | null = null;
  onsubmit: ((event?: any) => any) | null = null;
  classList = new FakeClassList();
  children: FakeElement[] = [];
  #innerHTML = "";
  #textContent = "";

  get innerHTML() {
    return this.#innerHTML;
  }

  set innerHTML(value: string) {
    this.#innerHTML = value;
    this.children = [];
  }

  get textContent() {
    return this.#textContent;
  }

  set textContent(value: string) {
    this.#textContent = value;
    this.#innerHTML = value;
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  querySelectorAll(_selector: string) {
    return [] as FakeElement[];
  }

  closest(_selector: string) {
    return null;
  }

  showModal() {}

  close() {}

  reset() {
    this.value = "";
    this.checked = false;
  }
}

function createDocument() {
  const elements = new Map<string, FakeElement>();
  const viewTabs = ["tasks", "agents", "projects", "timeline"].map((view) => {
    const el = new FakeElement();
    el.dataset.view = view;
    return el;
  });

  return {
    createElement(_tag: string) {
      return new FakeElement();
    },
    getElementById(id: string) {
      let el = elements.get(id);
      if (!el) {
        el = new FakeElement();
        el.id = id;
        elements.set(id, el);
      }
      return el;
    },
    querySelectorAll(selector: string) {
      if (selector === ".view-tab") {
        return viewTabs;
      }
      return [] as FakeElement[];
    },
  };
}

function createFetch(overrides: Record<string, unknown> = {}) {
  return async (path: string) => {
    if (path in overrides) {
      return {
        ok: true,
        status: 200,
        async json() {
          return overrides[path];
        },
      };
    }

    if (path === "/api/agents") {
      return {
        ok: true,
        status: 200,
        async json() {
          return [
            {
              id: "agent-1",
              name: "codex",
              type: "custom",
              command_template: "echo hello",
              heartbeat_enabled: 0,
              heartbeat_cron: null,
              heartbeat_next_run: null,
              active: 1,
            },
          ];
        },
      };
    }

    if (path === "/api/tasks") {
      return {
        ok: true,
        status: 200,
        async json() {
          return [];
        },
      };
    }

    if (path === "/api/agents/agent-1") {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "agent-1",
            name: "codex",
            type: "custom",
            command_template: "echo hello",
            heartbeat_enabled: 0,
            heartbeat_cron: null,
            heartbeat_next_run: null,
            active: 1,
            created_at: "2026-03-26T00:00:00.000Z",
            assigned_issues: [
              {
                id: "task-1",
                title: "Investigate bug",
                status: "in_progress",
                priority: "high",
                updated_at: "2026-03-26T00:00:00.000Z",
              },
            ],
          };
        },
      };
    }

    throw new Error(`Unhandled fetch path: ${path}`);
  };
}

async function loadWebApp(fetchOverrides: Record<string, unknown> = {}) {
  const html = readFileSync(join(import.meta.dir, "..", "src", "web", "index.html"), "utf8");
  const scriptMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
  if (!scriptMatch) {
    throw new Error("Expected module script in src/web/index.html");
  }

  const entrySrc = scriptMatch[1];
  const entryPath = join(import.meta.dir, "..", "src", "web", entrySrc.replace(/^\//, ""));
  const apiClient = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "api-client.js"), "utf8").replace(/^export /gm, "");
  const constants = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "constants.js"), "utf8").replace(/^export /gm, "");
  const router = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "router.js"), "utf8").replace(/^export /gm, "");
  const approvalsView = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "views", "approvals-view.js"), "utf8")
    .replace(/^\s*import\s+[^;]+;\n/gm, "")
    .replace(/^export /gm, "");
  const agentsView = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "views", "agents-view.js"), "utf8")
    .replace(/^\s*import\s+[^;]+;\n/gm, "")
    .replace(/^export /gm, "");
  const projectsView = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "views", "projects-view.js"), "utf8")
    .replace(/^\s*import\s+[^;]+;\n/gm, "")
    .replace(/^export /gm, "");
  const runsView = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "views", "runs-view.js"), "utf8")
    .replace(/^\s*import\s+[^;]+;\n/gm, "")
    .replace(/^export /gm, "");
  const tasksController = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "views", "tasks-controller.js"), "utf8")
    .replace(/^\s*import\s+[^;]+;\n/gm, "")
    .replace(/^export /gm, "");
  const timelineView = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "views", "timeline-view.js"), "utf8")
    .replace(/^\s*import\s+[^;]+;\n/gm, "")
    .replace(/^export /gm, "");
  const uiUtils = readFileSync(join(import.meta.dir, "..", "src", "web", "app", "ui-utils.js"), "utf8").replace(/^export /gm, "");
  const mainScript = readFileSync(entryPath, "utf8").replace(/^\s*import\s+[^;]+;\n/gm, "");
  const bundledScript = `${apiClient}\n${constants}\n${router}\n${uiUtils}\n${agentsView}\n${approvalsView}\n${projectsView}\n${runsView}\n${tasksController}\n${timelineView}\n${mainScript}`;

  const document = createDocument();
  const window = {
    location: { href: "http://localhost/agents", pathname: "/agents" },
    history: { replaceState() {}, pushState() {} },
    addEventListener() {},
  };

  const runScript = new Function(
    "document",
    "window",
    "fetch",
    "URL",
    "alert",
    "confirm",
    "setInterval",
    "clearInterval",
    "setTimeout",
    `${bundledScript}\nreturn { state, renderAgents, renderTasks, renderRuns, renderApprovals };`,
  );

  const app = runScript(
    document,
    window,
    createFetch(fetchOverrides),
    URL,
    () => {},
    () => true,
    () => 1,
    () => {},
    (fn: () => void) => fn(),
  ) as {
    state: Record<string, unknown>;
    renderAgents: () => void;
    renderTasks: () => void;
    renderRuns: () => void;
    renderApprovals: () => void;
  };

  return { app, document };
}

test("agents view expands details on first click and shows assigned issues", async () => {
  const { app, document } = await loadWebApp();
  expect(app.state.agentDetails).toBeDefined();
  app.state.agents = [
    {
      id: "agent-1",
      name: "codex",
      type: "custom",
      command_template: "echo hello",
      heartbeat_enabled: 0,
      heartbeat_cron: null,
      heartbeat_next_run: null,
      active: 1,
    },
  ];
  app.renderAgents();

  const table = document.getElementById("agents-table");
  const row = table.children[0];
  expect(row).toBeDefined();

  expect(() => row?.onclick?.({ target: { closest: () => null } })).not.toThrow();
  expect(table.children).toHaveLength(2);
  expect(table.children[1]?.innerHTML).toContain("Loading details...");

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(table.children).toHaveLength(2);
  expect(table.children[1]?.innerHTML).toContain("Assigned Tasks (1)");
  expect(table.children[1]?.innerHTML).toContain("Investigate bug");
});

test("tasks view renders reassignment controls for expanded task details", async () => {
  const { app, document } = await loadWebApp();
  app.state.agents = [
    {
      id: "agent-1",
      name: "codex",
      type: "custom",
      command_template: "echo hello",
      heartbeat_enabled: 0,
      heartbeat_cron: null,
      heartbeat_next_run: null,
      active: 1,
    },
    {
      id: "agent-2",
      name: "claude",
      type: "custom",
      command_template: "echo hi",
      heartbeat_enabled: 0,
      heartbeat_cron: null,
      heartbeat_next_run: null,
      active: 1,
    },
  ];
  app.state.tasks = [
    {
      id: "task-1",
      title: "Investigate bug",
      description: "Need to hand this off",
      status: "in_progress",
      priority: "high",
      agent: "codex",
      reviewer: null,
      stdout: "",
      stderr: "",
      commit_hash: null,
      started_at: null,
      completed_at: null,
      created_at: "2026-03-26T00:00:00.000Z",
    },
  ];
  app.state.expandedTaskId = "task-1";
  app.state.taskComments = { "task-1": [] };

  app.renderTasks();

  const table = document.getElementById("tasks-table");
  expect(table.children).toHaveLength(2);
  expect(table.children[1]?.innerHTML).toContain('name="agent"');
  expect(table.children[1]?.innerHTML).toContain("Unassigned");
  expect(table.children[1]?.innerHTML).toContain("claude (custom)");
  expect(table.children[1]?.innerHTML).toContain("task-reassign-button");
  expect(table.children[1]?.innerHTML).toContain("Reassign task");
});

test("runs view shows cost column and formats cost_cents as dollars", async () => {
  const { app, document } = await loadWebApp();
  app.state.runs = [
    {
      id: "run-1",
      task_id: "task-1",
      task_title: "Fix the bug",
      agent: "codex",
      status: "done",
      exit_code: 0,
      stdout: "done",
      stderr: "",
      commit_hash: null,
      workspace_dir: null,
      timed_out: 0,
      cost_cents: 250,
      started_at: "2026-03-26T00:00:00.000Z",
      completed_at: "2026-03-26T00:01:00.000Z",
      created_at: "2026-03-26T00:00:00.000Z",
    },
  ];
  app.renderRuns();

  const table = document.getElementById("runs-table");
  expect(table.children).toHaveLength(1);
  const rowHtml = table.children[0]?.innerHTML ?? "";
  expect(rowHtml).toContain("Fix the bug");
  expect(rowHtml).toContain("$2.50");
});

test("runs view shows cost as dash when cost_cents is zero", async () => {
  const { app, document } = await loadWebApp();
  app.state.runs = [
    {
      id: "run-2",
      task_id: "task-2",
      task_title: "Deploy",
      agent: "codex",
      status: "done",
      exit_code: 0,
      stdout: "",
      stderr: "",
      commit_hash: null,
      workspace_dir: null,
      timed_out: 0,
      cost_cents: 0,
      started_at: "2026-03-26T00:00:00.000Z",
      completed_at: "2026-03-26T00:01:00.000Z",
      created_at: "2026-03-26T00:00:00.000Z",
    },
  ];
  app.renderRuns();

  const table = document.getElementById("runs-table");
  expect(table.children[0]?.innerHTML).toContain("Deploy");
  // zero cost renders as dash
  const cells = table.children[0]?.innerHTML ?? "";
  expect(cells).not.toContain("$0.00");
});

test("runs view expanded detail shows cost field", async () => {
  const { app, document } = await loadWebApp();
  app.state.runs = [
    {
      id: "run-3",
      task_id: "task-3",
      task_title: "Refactor",
      agent: "codex",
      status: "done",
      exit_code: 0,
      stdout: "ok",
      stderr: "",
      commit_hash: null,
      workspace_dir: null,
      timed_out: 0,
      cost_cents: 100,
      started_at: "2026-03-26T00:00:00.000Z",
      completed_at: "2026-03-26T00:01:00.000Z",
      created_at: "2026-03-26T00:00:00.000Z",
    },
  ];
  app.state.expandedRunId = "run-3";
  app.renderRuns();

  const table = document.getElementById("runs-table");
  expect(table.children).toHaveLength(2);
  expect(table.children[1]?.innerHTML).toContain("Cost");
  expect(table.children[1]?.innerHTML).toContain("$1.00");
});

test("approvals view renders pending approvals with approve and deny buttons", async () => {
  const { app, document } = await loadWebApp();
  app.state.approvals = [
    {
      id: "approval-1",
      agent_id: "agent-abc123",
      run_id: null,
      task_id: "task-xyz789",
      reason: "Need to delete production database",
      status: "pending",
      resolved_by: null,
      resolved_at: null,
      created_at: "2026-03-26T00:00:00.000Z",
    },
  ];
  app.renderApprovals();

  const table = document.getElementById("approvals-table");
  expect(table.children).toHaveLength(1);
  const rowHtml = table.children[0]?.innerHTML ?? "";
  expect(rowHtml).toContain("Need to delete production database");
  expect(rowHtml).toContain("pending");
  expect(rowHtml).toContain("approval-approve");
  expect(rowHtml).toContain("approval-deny");
  expect(rowHtml).toContain("Approve");
  expect(rowHtml).toContain("Deny");
});

test("approvals view shows no action buttons for resolved approvals", async () => {
  const { app, document } = await loadWebApp();
  app.state.approvals = [
    {
      id: "approval-2",
      agent_id: "agent-abc123",
      run_id: "run-xyz",
      task_id: null,
      reason: "Deploy to production",
      status: "approved",
      resolved_by: "operator",
      resolved_at: "2026-03-26T01:00:00.000Z",
      created_at: "2026-03-26T00:00:00.000Z",
    },
  ];
  app.renderApprovals();

  const table = document.getElementById("approvals-table");
  const rowHtml = table.children[0]?.innerHTML ?? "";
  expect(rowHtml).toContain("Deploy to production");
  expect(rowHtml).toContain("approved");
  expect(rowHtml).not.toContain("approval-approve");
  expect(rowHtml).not.toContain("approval-deny");
  expect(rowHtml).toContain("operator");
});

test("approvals view shows empty state when no approvals", async () => {
  const { app, document } = await loadWebApp();
  app.state.approvals = [];
  app.renderApprovals();

  const table = document.getElementById("approvals-table");
  expect(table.innerHTML).toContain("No");
});
