# HeartBeat

Create your next self-running company.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
```

## What Is This

HeartBeat is an agent orchestration platform where users create tasks and CLI agents execute them autonomously. The long-term goal is a system that can manage and improve its own development workflow.

## Status

Current version: `0.1.0` (bootstrap scaffold)

Implemented in this stage:
- Bun + TypeScript project foundation
- Hono HTTP server on port `4400`
- Placeholder API route modules for tasks, agents, and runs
- Initial database schema/migration stubs
- Executor and config type placeholders

## Tech Stack

- Runtime: Bun
- Language: TypeScript (`strict`)
- Server: Hono
- Scheduling: Croner
- CLI tooling: Commander
- Config parsing: js-yaml
- Frontend foundation: React dependencies + static `index.html`

## Quick Start

Prerequisites:
- Bun `>= 1.3`

Install dependencies:

```bash
bun install
```

Start development server:

```bash
bun run src/server/index.ts
```

Verify server:

```bash
curl http://localhost:4400/
# <h1>HeartBeat v0.1.0</h1>
```

Type check:

```bash
bun run typecheck
```

## Project Structure

```text
src/
  server/
    index.ts
    routes/
      tasks.ts
      agents.ts
      runs.ts
  web/
    index.html
  db/
    schema.ts
    migrations.ts
  executor/
    index.ts
  config/
    types.ts
examples/
  heartbeat.yaml
tests/
```

## Near-Term Roadmap

1. Implement SQLite-backed task and agent persistence.
2. Build task management API endpoints.
3. Add executor runtime for CLI agent runs.
4. Add git workspace handling for task runs.
5. Add scheduler heartbeats for recurring work.

## License

MIT. See [LICENSE](./LICENSE).
