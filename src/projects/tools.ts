import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ProjectToolUsage = {
  total: number;
  breakdown: Array<{ tool: string; count: number; percentage: number }>;
};

export function scanProjectTools(projectPath: string): ProjectToolUsage {
  const dirName = projectPath.replace(/\//g, "-");
  const sessionsDir = join(homedir(), ".claude", "projects", dirName);

  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return { total: 0, breakdown: [] };
  }

  const counts = new Map<string, number>();

  for (const file of files) {
    const filePath = join(sessionsDir, file);

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

        if (parsed.type === "assistant") {
          const message = parsed.message as Record<string, unknown> | undefined;
          if (message && Array.isArray(message.content)) {
            for (const item of message.content as Array<Record<string, unknown>>) {
              if (item.type === "tool_use" && typeof item.name === "string") {
                counts.set(item.name, (counts.get(item.name) || 0) + 1);
              }
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }

  const breakdown = Array.from(counts.entries())
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { total, breakdown };
}
