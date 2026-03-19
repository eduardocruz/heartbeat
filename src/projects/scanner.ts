import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type ScannedProject = {
  name: string;
  path: string;
  source: "claude_code";
};

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
