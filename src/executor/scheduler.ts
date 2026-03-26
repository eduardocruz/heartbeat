import { Database } from "bun:sqlite";
import { Cron } from "croner";
import { isActiveTaskStatus } from "../tasks/workflow";

type AgentHeartbeatRow = {
  id: string;
  name: string;
  heartbeat_cron: string | null;
  heartbeat_prompt: string | null;
  heartbeat_repo: string | null;
  heartbeat_enabled: number;
};

type SchedulerLogger = Pick<Console, "info" | "warn" | "error">;

export type HeartbeatTriggerResult = "created" | "skipped_running" | "skipped_disabled" | "not_found";

export type SchedulerStatus = {
  totalSchedules: number;
  nextRuns: Array<{ agentId: string; agentName: string; nextRun: string | null }>;
};

export class Scheduler {
  private jobs = new Map<string, Cron>();

  constructor(
    private readonly db: Database,
    private readonly logger: SchedulerLogger = console,
  ) {}

  start(): void {
    const agents = this.getHeartbeatAgents();

    for (const agent of agents) {
      this.scheduleAgent(agent);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  reload(): void {
    this.stop();
    this.start();
  }

  getNextRun(agentId: string): string | null {
    const job = this.jobs.get(agentId);
    if (!job) {
      return null;
    }

    const next = job.nextRun();
    return next ? next.toISOString() : null;
  }

  getStatus(): SchedulerStatus {
    const nextRuns = Array.from(this.jobs.entries()).map(([agentId, job]) => {
      const agent = this.db.query("SELECT name FROM agents WHERE id = ? LIMIT 1").get(agentId) as {
        name: string;
      } | null;
      const nextRun = job.nextRun();

      return {
        agentId,
        agentName: agent?.name ?? agentId,
        nextRun: nextRun ? nextRun.toISOString() : null,
      };
    });

    return {
      totalSchedules: this.jobs.size,
      nextRuns,
    };
  }

  async triggerAgent(agentId: string): Promise<HeartbeatTriggerResult> {
    const agent = this.getAgentById(agentId);
    if (!agent) {
      return "not_found";
    }

    return this.runHeartbeat(agent);
  }

  private getHeartbeatAgents(): AgentHeartbeatRow[] {
    return this.db
      .query(
        `SELECT id, name, heartbeat_cron, heartbeat_prompt, heartbeat_repo, heartbeat_enabled
         FROM agents
         WHERE heartbeat_enabled = 1
           AND heartbeat_cron IS NOT NULL
           AND trim(heartbeat_cron) <> ''`,
      )
      .all() as AgentHeartbeatRow[];
  }

  private getAgentById(id: string): AgentHeartbeatRow | null {
    return (this.db
      .query(
        `SELECT id, name, heartbeat_cron, heartbeat_prompt, heartbeat_repo, heartbeat_enabled
         FROM agents
         WHERE id = ?`,
      )
      .get(id) as AgentHeartbeatRow | null) ?? null;
  }

  private scheduleAgent(agent: AgentHeartbeatRow): void {
    if (!agent.heartbeat_cron) {
      return;
    }

    try {
      const job = new Cron(agent.heartbeat_cron, async () => {
        await this.runHeartbeatById(agent.id);
      });
      this.jobs.set(agent.id, job);
    } catch (error) {
      this.logger.error(
        `Failed to schedule heartbeat for agent ${agent.name} (${agent.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runHeartbeatById(agentId: string): Promise<void> {
    const agent = this.getAgentById(agentId);
    if (!agent) {
      return;
    }

    await this.runHeartbeat(agent);
  }

  private async runHeartbeat(agent: AgentHeartbeatRow): Promise<HeartbeatTriggerResult> {
    if (agent.heartbeat_enabled !== 1 || !agent.heartbeat_cron) {
      return "skipped_disabled";
    }

    const existingTasks = this.db
      .query("SELECT id, status FROM tasks WHERE agent = ? ORDER BY created_at DESC LIMIT 25")
      .all(agent.name) as Array<{ id: string; status: string }>;
    const runningTask = existingTasks.find((task) => isActiveTaskStatus(task.status)) ?? null;

    if (runningTask) {
      this.logger.info(`Skipping heartbeat for ${agent.name}: previous run still active`);
      return "skipped_running";
    }

    this.db
      .query(
        `INSERT INTO tasks (
          title,
          description,
          status,
          priority,
          agent,
          repo_url,
          updated_at
        ) VALUES (?, ?, 'todo', 'medium', ?, ?, datetime('now'))`,
      )
      .run(
        `[heartbeat] ${agent.name}`,
        agent.heartbeat_prompt,
        agent.name,
        agent.heartbeat_repo,
      );

    return "created";
  }
}
