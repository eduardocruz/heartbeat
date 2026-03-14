import { rmSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const WORKSPACE_ROOT = path.join(homedir(), ".heartbeat", "workspaces");
const CLEANUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export async function setupWorkspace(repoUrl: string, taskId: string, branch = "main"): Promise<string> {
  const workdir = path.join(WORKSPACE_ROOT, taskId);

  rmSync(workdir, { recursive: true, force: true });
  await Bun.$`mkdir -p ${WORKSPACE_ROOT}`;
  await Bun.$`git clone ${repoUrl} ${workdir}`;

  if (branch && branch !== "main") {
    await Bun.$`git -C ${workdir} checkout ${branch}`;
  }

  return workdir;
}

export async function getLatestCommit(workdir: string): Promise<string | null> {
  try {
    const result = await Bun.$`git -C ${workdir} rev-parse HEAD`.text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

export function cleanupOldWorkspaces(now = Date.now()): void {
  try {
    const entries = readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(WORKSPACE_ROOT, entry.name);
      const ageMs = now - statSync(fullPath).mtimeMs;
      if (ageMs > CLEANUP_AFTER_MS) {
        rmSync(fullPath, { recursive: true, force: true });
      }
    }
  } catch {
    // Best-effort cleanup should never fail task execution.
  }
}
