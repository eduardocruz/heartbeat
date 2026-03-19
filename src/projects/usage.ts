import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ProjectUsage = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  estimatedCostUsd: number;
  sessionCount: number;
};

const COST_PER_MILLION = {
  input: 3.0,
  output: 15.0,
  cacheCreation: 3.75,
  cacheRead: 0.3,
};

export function scanProjectUsage(projectPath: string): ProjectUsage {
  const dirName = projectPath.replace(/\//g, "-");
  const sessionsDir = join(homedir(), ".claude", "projects", dirName);

  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      estimatedCostUsd: 0,
      sessionCount: 0,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let sessionCount = 0;

  for (const file of files) {
    const filePath = join(sessionsDir, file);
    let hasUsage = false;

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
          if (message && message.usage) {
            const usage = message.usage as Record<string, number>;
            totalInputTokens += usage.input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;
            totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
            totalCacheReadTokens += usage.cache_read_input_tokens || 0;
            hasUsage = true;
          }
        }
      }
    } catch {
      continue;
    }

    if (hasUsage) sessionCount++;
  }

  const estimatedCostUsd =
    (totalInputTokens / 1_000_000) * COST_PER_MILLION.input +
    (totalOutputTokens / 1_000_000) * COST_PER_MILLION.output +
    (totalCacheCreationTokens / 1_000_000) * COST_PER_MILLION.cacheCreation +
    (totalCacheReadTokens / 1_000_000) * COST_PER_MILLION.cacheRead;

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
    sessionCount,
  };
}
