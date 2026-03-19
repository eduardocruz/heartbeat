import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type ScannedProject = {
  name: string;
  path: string;
  source: "claude_code";
};

export type SessionSummary = {
  sessionId: string;
  lastActiveAt: string;
  messageCount: number;
  firstMessage: string | null;
};

export function scanProjectSessions(projectPath: string): SessionSummary[] {
  // Convert project path to Claude Code directory name
  // e.g. "/home/user/myproject" → "-home-user-myproject"
  const dirName = projectPath.replace(/\//g, "-");
  const sessionsDir = join(homedir(), ".claude", "projects", dirName);

  let files: string[];
  try {
    files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const sessions: SessionSummary[] = [];

  for (const file of files) {
    const filePath = join(sessionsDir, file);
    const sessionId = file.replace(/\.jsonl$/, "");

    let lastActiveAt: string;
    try {
      const stat = statSync(filePath);
      lastActiveAt = stat.mtime.toISOString();
    } catch {
      continue;
    }

    let messageCount = 0;
    let firstMessage: string | null = null;

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        if (parsed.type === "user" || parsed.type === "assistant") {
          messageCount++;
        }

        if (parsed.type === "user" && firstMessage === null) {
          const msg = parsed.message as Record<string, unknown> | undefined;
          if (msg && msg.content) {
            if (typeof msg.content === "string") {
              firstMessage = msg.content.slice(0, 120);
            } else if (Array.isArray(msg.content)) {
              const textItem = (msg.content as Array<Record<string, unknown>>).find(
                (item) => item.type === "text",
              );
              if (textItem && typeof textItem.text === "string") {
                firstMessage = textItem.text.slice(0, 120);
              }
            }
          }
        }
      }
    } catch {
      // skip unreadable files
      continue;
    }

    sessions.push({ sessionId, lastActiveAt, messageCount, firstMessage });
  }

  sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
  return sessions;
}

export function scanClaudeProjects(): ScannedProject[] {
  const claudeProjectsDir = join(homedir(), ".claude", "projects");

  let entries: string[];
  try {
    entries = readdirSync(claudeProjectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  return entries.map((dirName) => {
    // Claude Code convention: leading hyphen = leading slash, rest: hyphens = slashes
    // e.g. "-home-user-myproject" → "/home/user/myproject"
    const raw = dirName.startsWith("-") ? dirName.slice(1) : dirName;
    const projectPath = raw.replace(/-/g, "/");
    const segments = projectPath.split("/").filter(Boolean);
    const name = segments[segments.length - 1] || dirName;

    return {
      name,
      path: `/${projectPath}`,
      source: "claude_code" as const,
    };
  });
}
