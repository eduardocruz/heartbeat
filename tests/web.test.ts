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

function createFetch() {
  return async (path: string) => {
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

async function loadWebApp() {
  const html = readFileSync(join(import.meta.dir, "..", "src", "web", "index.html"), "utf8");
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  if (!scriptMatch) {
    throw new Error("Expected inline script in src/web/index.html");
  }

  const document = createDocument();
  const window = {
    location: { href: "http://localhost/agents", pathname: "/agents" },
    history: { replaceState() {} },
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
    `${scriptMatch[1]}\nreturn { state, renderAgents, renderTasks };`,
  );

  const app = runScript(
    document,
    window,
    createFetch(),
    URL,
    () => {},
    () => true,
    () => 1,
    () => {},
    (fn: () => void) => fn(),
  ) as { state: Record<string, unknown>; renderAgents: () => void; renderTasks: () => void };

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
