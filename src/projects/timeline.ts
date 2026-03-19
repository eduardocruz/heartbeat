import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type HistoryLine = {
  display: string;
  project: string;
  timestamp: number;
  sessionId: string;
};

export type TimelineEntry = {
  project: string;
  projectName: string;
  sessionCount: number;
  firstMessage: string;
};

export type TimelineDay = {
  date: string;
  totalSessions: number;
  projects: TimelineEntry[];
};

export function scanGlobalTimeline(limitDays: number = 30): TimelineDay[] {
  const historyPath = join(homedir(), ".claude", "history.jsonl");

  let content: string;
  try {
    content = readFileSync(historyPath, "utf-8");
  } catch {
    return [];
  }

  const cutoff = Date.now() - limitDays * 24 * 60 * 60 * 1000;

  // date -> project -> { sessions: Set, firstMessage, firstTimestamp }
  const dayMap = new Map<
    string,
    Map<string, { sessions: Set<string>; firstMessage: string; firstTimestamp: number }>
  >();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let entry: HistoryLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!entry.timestamp || !entry.project || !entry.sessionId) continue;
    if (entry.timestamp < cutoff) continue;

    const date = new Date(entry.timestamp).toISOString().slice(0, 10);
    const project = entry.project;

    if (!dayMap.has(date)) dayMap.set(date, new Map());
    const projectMap = dayMap.get(date)!;

    if (!projectMap.has(project)) {
      projectMap.set(project, {
        sessions: new Set(),
        firstMessage: entry.display || "",
        firstTimestamp: entry.timestamp,
      });
    }

    const info = projectMap.get(project)!;
    info.sessions.add(entry.sessionId);

    if (entry.timestamp < info.firstTimestamp) {
      info.firstTimestamp = entry.timestamp;
      info.firstMessage = entry.display || "";
    }
  }

  const days: TimelineDay[] = [];

  for (const [date, projectMap] of dayMap) {
    const projects: TimelineEntry[] = [];
    let totalSessions = 0;

    for (const [project, info] of projectMap) {
      const segments = project.split("/").filter(Boolean);
      const projectName = segments[segments.length - 1] || project;
      const sessionCount = info.sessions.size;
      totalSessions += sessionCount;

      projects.push({
        project,
        projectName,
        sessionCount,
        firstMessage: info.firstMessage,
      });
    }

    projects.sort((a, b) => b.sessionCount - a.sessionCount);
    days.push({ date, totalSessions, projects });
  }

  days.sort((a, b) => (a.date > b.date ? -1 : 1));
  return days;
}
