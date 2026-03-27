import { rmSync, readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const WORKSPACE_ROOT = path.join(homedir(), ".heartbeat", "workspaces");
const DEFAULT_CLEANUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_RUN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface WorkspaceCleanupOptions {
  retentionMs?: number;
  failedRetentionMs?: number;
}

/**
 * Standardised branch name for heartbeat-managed workspaces.
 * Format: heartbeat/{agentName}/{taskId-prefix}
 */
export function workspaceBranchName(agentName: string, taskId: string): string {
  const shortId = taskId.slice(0, 8);
  const safeName = agentName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `heartbeat/${safeName}/${shortId}`;
}

export async function setupWorkspace(
  repoUrl: string,
  taskId: string,
  branch = "main",
  agentName?: string,
): Promise<string> {
  const workdir = path.join(WORKSPACE_ROOT, taskId);

  rmSync(workdir, { recursive: true, force: true });

  try {
    await Bun.$`mkdir -p ${WORKSPACE_ROOT}`;
  } catch (err) {
    throw new Error(
      `Cannot create workspace directory ${WORKSPACE_ROOT}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Check that the parent directory exists and is writable.`,
    );
  }

  try {
    await Bun.$`git clone ${repoUrl} ${workdir}`.quiet();
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    if (/Repository not found|does not exist/i.test(stderr)) {
      throw new Error(
        `Git clone failed: repository '${repoUrl}' not found. Verify the URL and access credentials.`,
      );
    }
    if (/Authentication failed|could not read.*credentials/i.test(stderr)) {
      throw new Error(
        `Git clone failed: authentication error for '${repoUrl}'. Ensure SSH keys or tokens are configured.`,
      );
    }
    if (/Could not resolve host/i.test(stderr)) {
      throw new Error(
        `Git clone failed: cannot resolve host in '${repoUrl}'. Check network connectivity and the URL.`,
      );
    }
    throw new Error(
      `Git clone failed for '${repoUrl}': ${stderr}`,
    );
  }

  if (branch && branch !== "main") {
    try {
      await Bun.$`git -C ${workdir} checkout ${branch}`.quiet();
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      const availableBranches = await listRemoteBranches(workdir);
      const branchHint = availableBranches.length > 0
        ? ` Available branches: ${availableBranches.slice(0, 10).join(", ")}${availableBranches.length > 10 ? "..." : ""}`
        : "";
      throw new Error(
        `Git checkout failed: branch '${branch}' not found in '${repoUrl}'.${branchHint} (${stderr})`,
      );
    }
  }

  // Create a workspace branch for heartbeat if agent name is provided
  if (agentName) {
    const hbBranch = workspaceBranchName(agentName, taskId);
    try {
      await Bun.$`git -C ${workdir} checkout -b ${hbBranch}`.quiet();
    } catch {
      // Non-fatal: workspace still works on the base branch
    }
  }

  // Write metadata for cleanup decisions
  writeWorkspaceMeta(workdir, { taskId, repoUrl, branch, agentName });

  return workdir;
}

export async function getLatestCommit(workdir: string): Promise<string | null> {
  try {
    const result = await Bun.$`git -C ${workdir} rev-parse HEAD`.quiet().text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Mark a workspace as belonging to a failed run so it is retained longer.
 */
export function markWorkspaceFailed(taskId: string): void {
  const workdir = path.join(WORKSPACE_ROOT, taskId);
  if (!existsSync(workdir)) return;
  const meta = readWorkspaceMeta(workdir);
  writeWorkspaceMeta(workdir, { ...meta, failed: true, failedAt: new Date().toISOString() });
}

export function cleanupOldWorkspaces(
  now = Date.now(),
  options: WorkspaceCleanupOptions = {},
): { removed: string[]; retained: string[] } {
  const retentionMs = options.retentionMs ?? DEFAULT_CLEANUP_AFTER_MS;
  const failedRetentionMs = options.failedRetentionMs ?? FAILED_RUN_RETENTION_MS;
  const removed: string[] = [];
  const retained: string[] = [];

  try {
    const entries = readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(WORKSPACE_ROOT, entry.name);
      const ageMs = now - statSync(fullPath).mtimeMs;
      const meta = readWorkspaceMeta(fullPath);
      const threshold = meta?.failed ? failedRetentionMs : retentionMs;

      if (ageMs > threshold) {
        rmSync(fullPath, { recursive: true, force: true });
        removed.push(entry.name);
      } else {
        retained.push(entry.name);
      }
    }
  } catch {
    // Best-effort cleanup should never fail task execution.
  }

  return { removed, retained };
}

interface WorkspaceMeta {
  taskId?: string;
  repoUrl?: string;
  branch?: string;
  agentName?: string;
  failed?: boolean;
  failedAt?: string;
}

function writeWorkspaceMeta(workdir: string, meta: WorkspaceMeta): void {
  try {
    const metaPath = path.join(workdir, ".heartbeat-workspace.json");
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // Non-fatal: metadata is advisory
  }
}

function readWorkspaceMeta(workdir: string): WorkspaceMeta | null {
  try {
    const metaPath = path.join(workdir, ".heartbeat-workspace.json");
    if (!existsSync(metaPath)) return null;
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

async function listRemoteBranches(workdir: string): Promise<string[]> {
  try {
    const result = await Bun.$`git -C ${workdir} branch -r --format=%(refname:short)`.quiet().text();
    return result
      .trim()
      .split("\n")
      .map((b) => b.replace(/^origin\//, "").trim())
      .filter((b) => b && b !== "HEAD");
  } catch {
    return [];
  }
}
