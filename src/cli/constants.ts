import { homedir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";

export const HEARTBEAT_VERSION = packageJson.version;
export const DEFAULT_PORT = "4400";

export function getHeartbeatHome(): string {
  return join(process.env.HOME ?? homedir(), ".heartbeat");
}

export function getDefaultDbPath(): string {
  return process.env.HEARTBEAT_DB_PATH ?? join(getHeartbeatHome(), "heartbeat.db");
}

export function getDefaultConfigPath(): string {
  return join(process.cwd(), "heartbeat.yaml");
}

export function getDefaultStatePath(): string {
  return join(getHeartbeatHome(), "daemon.json");
}

export function getDefaultLogPath(): string {
  return join(getHeartbeatHome(), "heartbeat.log");
}
