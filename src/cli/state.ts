import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DaemonState = {
  pid: number;
  port: number;
  dbPath: string;
  logPath: string;
  startedAt: string;
};

export function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonState(path: string): DaemonState | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

export function writeDaemonState(path: string, state: DaemonState): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function removeDaemonState(path: string): void {
  rmSync(path, { force: true });
}
