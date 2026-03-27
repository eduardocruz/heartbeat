import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { spawnSync } from "node:child_process";
import type { Scheduler } from "../../executor/scheduler";
import { readJsonObject } from "../http";

type SqlParam = string | number | bigint | boolean | Uint8Array | null;

export const KNOWN_TOOLS = new Set([
  "bash",
  "file_read",
  "file_write",
  "git_commit",
  "git_push",
  "web_search",
  "web_fetch",
  "code_review",
  "deploy",
]);

type PolicyRow = {
  agent_id: string;
  denied_tools: string;
  approval_required_tools: string;
};

type PolicyResponse = {
  agent_id: string;
  denied_tools: string[];
  approval_required_tools: string[];
};

type AgentRow = {
  id: string;
  name: string;
  type: string;
  command_template: string;
  active: number;
  heartbeat_cron: string | null;
  heartbeat_prompt: string | null;
  heartbeat_repo: string | null;
  heartbeat_enabled: number;
  budget_limit_cents: number | null;
  created_at: string;
};

type AgentResponse = AgentRow & {
  heartbeat_next_run: string | null;
};

type AssignedIssueRow = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
};

type AgentDetailsResponse = AgentResponse & {
  assigned_issues: AssignedIssueRow[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function withNextRun(agent: AgentRow, scheduler?: Scheduler): AgentResponse {
  const nextRun = scheduler ? scheduler.getNextRun(agent.id) : null;
  return {
    ...agent,
    heartbeat_next_run: nextRun,
  };
}

function findAgent(db: Database, idOrName: string): AgentRow | null {
  return (
    (db.query("SELECT * FROM agents WHERE id = ?").get(idOrName) as AgentRow | null)
    ?? (db.query("SELECT * FROM agents WHERE name = ?").get(idOrName) as AgentRow | null)
  );
}

function withAssignedIssues(db: Database, agent: AgentRow, scheduler?: Scheduler): AgentDetailsResponse {
  const assignedIssues = db
    .query(
      "SELECT id, title, status, priority, created_at, updated_at FROM tasks WHERE agent = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(agent.name) as AssignedIssueRow[];

  return {
    ...withNextRun(agent, scheduler),
    assigned_issues: assignedIssues,
  };
}

const AVATAR_PARAMS = {
  topType: ["ShortHairShortFlat", "ShortHairShortRound", "ShortHairDreads01", "LongHairStraight", "LongHairBun", "LongHairCurly", "ShortHairShortCurly", "NoHair", "Hat", "LongHairBob", "ShortHairSides"],
  hairColor: ["Black", "Brown", "BrownDark", "Blonde", "BlondeGolden", "Auburn", "Red", "SilverGray", "Platinum"],
  skinColor: ["Light", "Yellow", "Tanned", "Brown", "DarkBrown", "Pale"],
  eyeType: ["Default", "Happy", "Squint", "Wink", "Surprised", "Side", "Close"],
  eyebrowType: ["Default", "DefaultNatural", "FlatNatural", "RaisedExcited", "UpDown"],
  mouthType: ["Default", "Smile", "Serious", "Twitch", "Tongue"],
  clotheType: ["Hoodie", "BlazerShirt", "CollarSweater", "GraphicShirt", "ShirtCrewNeck", "BlazerSweater"],
  clotheColor: ["Black", "Blue01", "Blue02", "Gray01", "Gray02", "Red", "White", "PastelBlue", "PastelOrange"],
  facialHairType: ["Blank", "BeardLight", "BeardMedium", "MoustacheFancy"],
  accessoriesType: ["Blank", "Prescription01", "Prescription02", "Round", "Sunglasses"],
} as const;

const NO_HAIR_TOPS = new Set(["NoHair", "Hat"]);

function buildAvatarUrl(params: Record<string, string>): string {
  const base = "https://avataaars.io/?avatarStyle=Circle";
  const parts = [base];
  for (const [key, value] of Object.entries(params)) {
    if (key === "hairColor" && NO_HAIR_TOPS.has(params.topType)) continue;
    parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

function runClaude(prompt: string): { ok: true; text: string } | { ok: false; error: string } {
  const result = spawnSync("claude", ["--print", prompt], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    encoding: "utf-8",
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: result.stderr?.toString() || "claude exited with non-zero status" };
  }
  return { ok: true, text: result.stdout?.toString() || "" };
}

export function createAgentsRoutes(db: Database, scheduler?: Scheduler): Hono {
  const agentsRoutes = new Hono();

  agentsRoutes.get("/", (c) => {
    const agents = db.query("SELECT * FROM agents ORDER BY created_at DESC").all() as AgentRow[];
    return c.json(agents.map((agent) => withNextRun(agent, scheduler)));
  });

  agentsRoutes.get("/:id", (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json(withAssignedIssues(db, agent, scheduler));
  });

  agentsRoutes.post("/", async (c) => {
    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (!isNonEmptyString(body.name) || !isNonEmptyString(body.type) || !isNonEmptyString(body.command_template)) {
      return c.json({ error: "name, type, and command_template are required" }, 400);
    }

    if ("heartbeat_cron" in body && body.heartbeat_cron !== null && !isNonEmptyString(body.heartbeat_cron)) {
      return c.json({ error: "heartbeat_cron must be a non-empty string or null" }, 400);
    }

    if ("heartbeat_enabled" in body && body.heartbeat_enabled !== 0 && body.heartbeat_enabled !== 1) {
      return c.json({ error: "heartbeat_enabled must be 0 or 1" }, 400);
    }

    const heartbeatCron = optionalText(body.heartbeat_cron);

    const budgetLimitCents =
      "budget_limit_cents" in body
        ? (typeof body.budget_limit_cents === "number" && body.budget_limit_cents >= 0
          ? Math.floor(body.budget_limit_cents)
          : null)
        : null;

    try {
      const result = db
        .query(
          "INSERT INTO agents (name, type, command_template, active, heartbeat_cron, heartbeat_prompt, heartbeat_repo, heartbeat_enabled, budget_limit_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          body.name.trim(),
          body.type.trim(),
          body.command_template.trim(),
          body.active === 0 ? 0 : 1,
          heartbeatCron,
          optionalText(body.heartbeat_prompt),
          optionalText(body.heartbeat_repo),
          body.heartbeat_enabled === 1 ? 1 : 0,
          budgetLimitCents,
        );

      scheduler?.reload();

      const created = db.query("SELECT * FROM agents WHERE rowid = ?").get(result.lastInsertRowid) as AgentRow;
      return c.json(withNextRun(created, scheduler), 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent name must be unique" }, 400);
      }
      return c.json({ error: "Failed to create agent" }, 400);
    }
  });

  agentsRoutes.get("/:id", (c) => {
    const id = c.req.param("id");
    const agent = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    type AssignedIssue = {
      id: string;
      title: string;
      status: string;
      priority: string | null;
      created_at: string;
      updated_at: string;
    };

    const assignedIssues = db
      .query("SELECT id, title, status, priority, created_at, updated_at FROM tasks WHERE agent = ? ORDER BY updated_at DESC LIMIT 100")
      .all(agent.name) as AssignedIssue[];

    return c.json({
      ...withNextRun(agent, scheduler),
      assigned_issues: assignedIssues,
    });
  });

  agentsRoutes.get("/:id/tasks", (c) => {
    const id = c.req.param("id");
    const agent = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const status = c.req.query("status");
    const limitRaw = c.req.query("limit");
    const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const limit = Number.isInteger(limitParsed) && limitParsed > 0 && limitParsed <= 500 ? limitParsed : 50;

    let tasks;
    if (status) {
      tasks = db
        .query("SELECT * FROM tasks WHERE agent = ? AND status = ? ORDER BY created_at DESC LIMIT ?")
        .all(agent.name, status, limit);
    } else {
      tasks = db
        .query("SELECT * FROM tasks WHERE agent = ? ORDER BY created_at DESC LIMIT ?")
        .all(agent.name, limit);
    }

    return c.json(tasks);
  });

  agentsRoutes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    const updates: string[] = [];
    const params: SqlParam[] = [];

    if ("name" in body) {
      if (!isNonEmptyString(body.name)) {
        return c.json({ error: "name must be a non-empty string" }, 400);
      }
      updates.push("name = ?");
      params.push(body.name.trim());
    }

    if ("type" in body) {
      if (!isNonEmptyString(body.type)) {
        return c.json({ error: "type must be a non-empty string" }, 400);
      }
      updates.push("type = ?");
      params.push(body.type.trim());
    }

    if ("command_template" in body) {
      if (!isNonEmptyString(body.command_template)) {
        return c.json({ error: "command_template must be a non-empty string" }, 400);
      }
      updates.push("command_template = ?");
      params.push(body.command_template.trim());
    }

    if ("active" in body) {
      if (body.active !== 0 && body.active !== 1) {
        return c.json({ error: "active must be 0 or 1" }, 400);
      }
      updates.push("active = ?");
      params.push(body.active);
    }

    if ("heartbeat_cron" in body) {
      if (body.heartbeat_cron !== null && !isNonEmptyString(body.heartbeat_cron)) {
        return c.json({ error: "heartbeat_cron must be a non-empty string or null" }, 400);
      }
      updates.push("heartbeat_cron = ?");
      params.push(optionalText(body.heartbeat_cron));
    }

    if ("heartbeat_prompt" in body) {
      if (body.heartbeat_prompt !== null && body.heartbeat_prompt !== undefined && typeof body.heartbeat_prompt !== "string") {
        return c.json({ error: "heartbeat_prompt must be a string or null" }, 400);
      }
      updates.push("heartbeat_prompt = ?");
      params.push(optionalText(body.heartbeat_prompt));
    }

    if ("heartbeat_repo" in body) {
      if (body.heartbeat_repo !== null && body.heartbeat_repo !== undefined && typeof body.heartbeat_repo !== "string") {
        return c.json({ error: "heartbeat_repo must be a string or null" }, 400);
      }
      updates.push("heartbeat_repo = ?");
      params.push(optionalText(body.heartbeat_repo));
    }

    if ("heartbeat_enabled" in body) {
      if (body.heartbeat_enabled !== 0 && body.heartbeat_enabled !== 1) {
        return c.json({ error: "heartbeat_enabled must be 0 or 1" }, 400);
      }
      updates.push("heartbeat_enabled = ?");
      params.push(body.heartbeat_enabled);
    }

    if ("budget_limit_cents" in body) {
      if (body.budget_limit_cents !== null && (typeof body.budget_limit_cents !== "number" || body.budget_limit_cents < 0)) {
        return c.json({ error: "budget_limit_cents must be a non-negative integer or null" }, 400);
      }
      updates.push("budget_limit_cents = ?");
      params.push(body.budget_limit_cents === null ? null : Math.floor(body.budget_limit_cents as number));
    }

    if (updates.length === 0) {
      return c.json({ error: "No valid fields provided" }, 400);
    }

    params.push(id);

    try {
      db.query(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      scheduler?.reload();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent name must be unique" }, 400);
      }
      return c.json({ error: "Failed to update agent" }, 400);
    }

    const updated = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
    return c.json(withNextRun(updated, scheduler));
  });

  agentsRoutes.post("/:id/heartbeat/toggle", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const nextEnabled = existing.heartbeat_enabled === 1 ? 0 : 1;
    db.query("UPDATE agents SET heartbeat_enabled = ? WHERE id = ?").run(nextEnabled, id);
    scheduler?.reload();

    const updated = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
    return c.json(withNextRun(updated, scheduler));
  });

  agentsRoutes.post("/generate-personas", async (c) => {
    const prompt = `Generate 5 diverse CEO agent personas for a software developer tool. Each persona should feel like a real person with a distinct personality and leadership style.

Return ONLY a JSON array (no markdown, no explanation) with exactly 5 objects:
[
  {
    "name": "First Last",
    "avatarParams": {
      "topType": "<one of: ${AVATAR_PARAMS.topType.join(", ")}>",
      "hairColor": "<one of: ${AVATAR_PARAMS.hairColor.join(", ")}; skip if topType is Hat/NoHair>",
      "skinColor": "<one of: ${AVATAR_PARAMS.skinColor.join(", ")}>",
      "eyeType": "<one of: ${AVATAR_PARAMS.eyeType.join(", ")}>",
      "eyebrowType": "<one of: ${AVATAR_PARAMS.eyebrowType.join(", ")}>",
      "mouthType": "<one of: ${AVATAR_PARAMS.mouthType.join(", ")}>",
      "clotheType": "<one of: ${AVATAR_PARAMS.clotheType.join(", ")}>",
      "clotheColor": "<one of: ${AVATAR_PARAMS.clotheColor.join(", ")}>",
      "facialHairType": "<one of: ${AVATAR_PARAMS.facialHairType.join(", ")}>",
      "accessoriesType": "<one of: ${AVATAR_PARAMS.accessoriesType.join(", ")}>"
    },
    "description": "2-3 sentence summary of this CEO personality and leadership style. What makes them unique. How they approach decisions."
  }
]

Make the 5 personas diverse in: personality (analytical vs intuitive), communication style (verbose vs direct), decision approach (fast vs methodical), and visual appearance (varied skin tones, hair styles, clothing). NO markdown, return ONLY the JSON array.`;

    const result = runClaude(prompt);
    if (!result.ok) {
      return c.json({ error: "Claude Code not available" }, 503);
    }

    let personas: Array<{ name: string; avatarParams: Record<string, string>; description: string }>;
    try {
      // Extract JSON array from response (strip any surrounding text)
      const text = result.text.trim();
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start === -1 || end === -1) throw new Error("No JSON array found");
      personas = JSON.parse(text.slice(start, end + 1));
    } catch {
      return c.json({ error: "Failed to parse Claude response" }, 502);
    }

    const mapped = personas.map((p) => ({
      name: p.name,
      avatarUrl: buildAvatarUrl(p.avatarParams),
      description: p.description,
    }));

    return c.json({ personas: mapped });
  });

  agentsRoutes.post("/hire", async (c) => {
    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    const name = optionalText(body.name);
    const avatarUrl = optionalText(body.avatarUrl);
    const description = optionalText(body.description);
    const role = optionalText(body.role);

    if (!name || !avatarUrl || !description) {
      return c.json({ error: "name, avatarUrl, and description are required" }, 400);
    }

    const soulPrompt = `Generate a SOUL.md file for an AI agent named ${name} with the role of CEO in a software development context.

The agent has this personality: ${description}

The SOUL.md should define:
- Identity: who this agent is, their name, role
- Core values: 3-5 principles that guide every decision
- Decision framework: how they approach problems
- Communication style: how they express themselves
- What they prioritize: what matters most to them
- What they avoid: what they refuse to do or deprioritize
- Relationship with the human: how they collaborate

Format it as a proper markdown document, around 300-400 words. Make it feel like a real character, not a corporate template.`;

    const result = runClaude(soulPrompt);
    if (!result.ok) {
      return c.json({ error: "Claude Code not available" }, 503);
    }

    const soulMd = result.text.trim();
    const agentRole = role ?? "ceo";

    try {
      const insertResult = db
        .query(
          "INSERT INTO agents (name, type, command_template, active, avatar_url, soul_md, role, description) VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
        )
        .run(
          name,
          "claude",
          "claude --print",
          avatarUrl,
          soulMd,
          agentRole,
          description,
        );

      scheduler?.reload();

      const created = db.query("SELECT * FROM agents WHERE rowid = ?").get(insertResult.lastInsertRowid) as AgentRow;
      return c.json(withNextRun(created, scheduler), 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent name must be unique" }, 400);
      }
      return c.json({ error: "Failed to create agent" }, 400);
    }
  });

  agentsRoutes.get("/:id/projects", (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const projects = db
      .query(
        "SELECT p.*, ap.role AS agent_role FROM agent_projects ap JOIN projects p ON ap.project_id = p.id WHERE ap.agent_id = ? ORDER BY p.name ASC",
      )
      .all(agent.id);
    return c.json(projects);
  });

  agentsRoutes.post("/:id/projects", async (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (!isNonEmptyString(body.project_id)) {
      return c.json({ error: "project_id is required" }, 400);
    }

    const project = db.query("SELECT id FROM projects WHERE id = ?").get(body.project_id) as { id: string } | null;
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const role = typeof body.role === "string" ? body.role.trim() : "contributor";

    try {
      db.query("INSERT INTO agent_projects (agent_id, project_id, role) VALUES (?, ?, ?)").run(
        agent.id,
        body.project_id,
        role,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return c.json({ error: "Agent is already linked to this project" }, 400);
      }
      throw error;
    }

    return c.json({ ok: true, agent_id: agent.id, project_id: body.project_id, role }, 201);
  });

  agentsRoutes.delete("/:id/projects/:projectId", (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const result = db
      .query("DELETE FROM agent_projects WHERE agent_id = ? AND project_id = ?")
      .run(agent.id, c.req.param("projectId"));

    if (result.changes === 0) {
      return c.json({ error: "Agent-project link not found" }, 404);
    }

    return c.json({ ok: true });
  });

  agentsRoutes.get("/:id/budget", (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const spentRow = db
      .query(
        "SELECT COALESCE(SUM(cost_cents), 0) AS spent FROM runs WHERE agent = ? AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')",
      )
      .get(agent.name) as { spent: number };

    const spentCents = spentRow.spent;
    const budgetLimitCents = agent.budget_limit_cents ?? null;
    const remainingCents = budgetLimitCents !== null ? Math.max(0, budgetLimitCents - spentCents) : null;

    return c.json({
      agent_id: agent.id,
      agent_name: agent.name,
      budget_limit_cents: budgetLimitCents,
      spent_cents: spentCents,
      remaining_cents: remainingCents,
    });
  });

  agentsRoutes.get("/:id/policy", (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const row = db
      .query("SELECT agent_id, denied_tools, approval_required_tools FROM agent_policies WHERE agent_id = ?")
      .get(agent.id) as PolicyRow | null;

    const response: PolicyResponse = {
      agent_id: agent.id,
      denied_tools: row ? (JSON.parse(row.denied_tools) as string[]) : [],
      approval_required_tools: row ? (JSON.parse(row.approval_required_tools) as string[]) : [],
    };
    return c.json(response);
  });

  agentsRoutes.put("/:id/policy", async (c) => {
    const agent = findAgent(db, c.req.param("id"));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const bodyResult = await readJsonObject(c);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }
    const body = bodyResult;

    if (!Array.isArray(body.denied_tools) || !Array.isArray(body.approval_required_tools)) {
      return c.json({ error: "denied_tools and approval_required_tools must be arrays" }, 400);
    }

    const deniedTools = body.denied_tools as unknown[];
    const approvalTools = body.approval_required_tools as unknown[];

    const allTools = [...deniedTools, ...approvalTools];
    const unknownTools = allTools.filter((t) => typeof t !== "string" || !KNOWN_TOOLS.has(t));
    if (unknownTools.length > 0) {
      return c.json({ error: `Unknown tool names: ${unknownTools.join(", ")}` }, 400);
    }

    const deniedSet = new Set(deniedTools as string[]);
    const conflicts = (approvalTools as string[]).filter((t) => deniedSet.has(t));
    if (conflicts.length > 0) {
      return c.json(
        { error: `Tool conflict: tools cannot be in both denied and approval_required: ${conflicts.join(", ")}` },
        400,
      );
    }

    const deniedJson = JSON.stringify(deniedTools);
    const approvalJson = JSON.stringify(approvalTools);

    db.query(
      `INSERT INTO agent_policies (agent_id, denied_tools, approval_required_tools)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         denied_tools = excluded.denied_tools,
         approval_required_tools = excluded.approval_required_tools,
         updated_at = datetime('now')`,
    ).run(agent.id, deniedJson, approvalJson);

    const response: PolicyResponse = {
      agent_id: agent.id,
      denied_tools: deniedTools as string[],
      approval_required_tools: approvalTools as string[],
    };
    return c.json(response);
  });

  agentsRoutes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    db.query("DELETE FROM agents WHERE id = ?").run(id);
    scheduler?.reload();
    return c.json({ ok: true });
  });

  return agentsRoutes;
}
