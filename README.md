# HeartBeat

HeartBeat is a local-first agent orchestration platform built with Bun, TypeScript, SQLite, and a lightweight web UI.

Current version: `0.2.3`

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
```

## What It Does

HeartBeat combines a daemon, HTTP API, scheduler, executor, and dashboard for running autonomous agent work on your machine.

Current repository capabilities include:

- A compiled `heartbeat` CLI with `init`, `start`, `status`, `stop`, `restart`, `logs`, and `update`
- Agent inspection from the CLI via `heartbeat agents show <agent>`
- A Bun + Hono server with task, agent, project, executor, timeline, and heatmap routes
- SQLite-backed persistence for tasks, agents, and projects
- A task executor that runs agent command templates, supports Git workspaces, records stdout/stderr, and captures commit hashes
- Cron-based agent heartbeats that enqueue recurring work
- Project analytics sourced from Claude Code history, including sessions, token usage, tool usage, hot files, timeline views, and a 90-day heatmap
- A web UI served from the same daemon

## Quick Start

Prerequisites:

- Bun `>= 1.3`

Install dependencies:

```bash
bun install
```

Run the server directly in development:

```bash
bun run dev
```

Or run the daemon flow through the CLI:

```bash
bun run start
```

Open the app:

```text
http://localhost:4400/
```

Check runtime status:

```bash
heartbeat status
```

Type-check and test:

```bash
bun run typecheck
bun test
```

Database schema changes are tracked through explicit SQLite migrations in [`src/db/migrations.ts`](./src/db/migrations.ts). Contributor expectations and upgrade verification live in [`docs/database-migrations.md`](./docs/database-migrations.md).

## Core Concepts

### Tasks

Tasks are persisted in SQLite and move through workflow-aware states like `todo`, `in_progress`, `in_review`, `done`, `blocked`, `failed`, or `cancelled`. Operators can attach review notes and handoff context directly to each task. Tasks can include:

- priority
- assigned agent name
- repo URL and branch for workspace execution
- timeout
- execution output and commit hash

### Agents

Agents define:

- `name`
- `type`
- `command_template`
- optional heartbeat schedule and prompt
- optional heartbeat repository

Heartbeat-enabled agents are scheduled via Croner and enqueue new tasks when their schedule fires.

### Projects

Projects are first-class records in the UI and API. They can be created manually or scanned from Claude Code project directories, then analyzed for:

- sessions
- token usage and estimated cost
- tool usage
- hot files
- global activity timeline
- contribution heatmap

## CLI Commands

```text
heartbeat init
heartbeat start [--port --db --state --log]
heartbeat status [--state]
heartbeat stop [--state]
heartbeat restart [--port --db --state --log]
heartbeat logs [agent] [--state --limit]
heartbeat agents show <agent> [--state]
heartbeat update
```

The daemon stores runtime state, logs, and SQLite data in HeartBeat-managed local paths by default.

## API Surface

Current routes are organized under:

- `/api/tasks`
- `/api/agents`
- `/api/agents/:id`
- `/api/projects`
- `/api/runs`
- `/api/executor`
- `/api/timeline`
- `/api/heatmap`

The root app also serves the dashboard at `/`, `/agents`, `/projects`, and `/timeline`.

## Project Structure

```text
src/
  cli/
  db/
  executor/
  projects/
  server/
  web/
docs/
  architecture-tier2.md
scripts/
  build-release.sh
install.sh
```

## Version Narrative

`0.1.x` established the local daemon, SQLite-backed task and agent model, release/install flow, and browser UI.

`0.2.x` adds the more opinionated operating layer:

- project ingestion from Claude Code directories
- project analytics dashboards
- agent hiring and SOUL document support
- daemon restart command

See [CHANGELOG.md](./CHANGELOG.md) for release-by-release details.

## License

MIT. See [LICENSE](./LICENSE).
