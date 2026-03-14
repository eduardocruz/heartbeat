import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createDatabase, getDefaultDbPath } from "../src/db";
import { createApp } from "../src/server/app";

const cleanupPaths: string[] = [];

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

  test("supports create/list/filter/get/update task flows", async () => {
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
    const created = await createResp.json();
    expect(typeof created.id).toBe("string");
    expect(created.status).toBe("pending");

    const listResp = await app.request("/api/tasks");
    expect(listResp.status).toBe(200);
    const list = await listResp.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);

    const filterResp = await app.request("/api/tasks?status=pending");
    expect(filterResp.status).toBe(200);
    const filtered = await filterResp.json();
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(created.id);

    const getResp = await app.request(`/api/tasks/${created.id}`);
    expect(getResp.status).toBe(200);

    const beforeUpdate = await getResp.json();
    const patchResp = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });

    expect(patchResp.status).toBe(200);
    const updated = await patchResp.json();
    expect(updated.status).toBe("running");
    expect(updated.updated_at >= beforeUpdate.updated_at).toBe(true);

    db.close();
  });
});
