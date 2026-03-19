import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type HistoryLine = {
  project: string;
  timestamp: number;
  sessionId: string;
};

export type HeatmapDay = {
  date: string;
  count: number;
  intensity: number;
};

export type HeatmapData = {
  days: HeatmapDay[];
  totalSessions: number;
  activeDays: number;
  maxDay: number;
};

function computeIntensity(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function scanActivityHeatmap(days: number = 90): HeatmapData {
  const historyPath = join(homedir(), ".claude", "history.jsonl");

  let content: string;
  try {
    content = readFileSync(historyPath, "utf-8");
  } catch {
    return buildResult(new Map(), days);
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // date -> Set of sessionIds
  const dayMap = new Map<string, Set<string>>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let entry: HistoryLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!entry.timestamp || !entry.sessionId) continue;
    if (entry.timestamp < cutoff) continue;

    const date = new Date(entry.timestamp).toISOString().slice(0, 10);

    if (!dayMap.has(date)) dayMap.set(date, new Set());
    dayMap.get(date)!.add(entry.sessionId);
  }

  return buildResult(dayMap, days);
}

function buildResult(dayMap: Map<string, Set<string>>, days: number): HeatmapData {
  const now = new Date();
  const allDays: HeatmapDay[] = [];
  let totalSessions = 0;
  let activeDays = 0;
  let maxDay = 0;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const sessions = dayMap.get(date);
    const count = sessions ? sessions.size : 0;

    totalSessions += count;
    if (count > 0) activeDays++;
    if (count > maxDay) maxDay = count;

    allDays.push({ date, count, intensity: computeIntensity(count) });
  }

  return { days: allDays, totalSessions, activeDays, maxDay };
}
