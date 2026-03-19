import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ProjectFileUsage = {
  total: number;
  topFiles: Array<{ path: string; count: number; shortPath: string }>;
};

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);

export function scanProjectFiles(projectPath: string): ProjectFileUsage {
  const dirName = projectPath.replace(/\//g, "-");
  const sessionsDir = join(homedir(), ".claude", "projects", dirName);

  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return { total: 0, topFiles: [] };
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
              if (
                item.type === "tool_use" &&
                typeof item.name === "string" &&
                FILE_TOOLS.has(item.name)
              ) {
                const input = item.input as Record<string, unknown> | undefined;
                if (input && typeof input.file_path === "string") {
                  counts.set(input.file_path, (counts.get(input.file_path) || 0) + 1);
                }
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

  const topFiles = Array.from(counts.entries())
    .map(([path, count]) => ({
      path,
      count,
      shortPath: path.split("/").slice(-2).join("/"),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { total, topFiles };
}
