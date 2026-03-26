import type { TaskStatus } from "../tasks/workflow";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  agent: string;
  reviewer?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  type: "claude" | "codex" | "custom";
  commandTemplate: string;
  heartbeatCron?: string;
  heartbeatPrompt?: string;
  heartbeatEnabled: boolean;
}
