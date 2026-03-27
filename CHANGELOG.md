# Changelog

All notable changes to HeartBeat are documented here.

## [0.2.9] — 2026-03-27

### Added
- **UI/UX Phase 5 complete**: delivered the full frontend workstream bundle from [SUP-61](/SUP/issues/SUP-61) through [SUP-65](/SUP/issues/SUP-65), including the design system foundation, component-based SPA architecture, core UX improvements, visual polish, and accessibility/responsiveness upgrades.
- **Vite-powered web pipeline**: introduced `web:dev` and `web:build` scripts with the corresponding Vite config for a maintainable frontend build loop.
- **Structured web app modules**: replaced the monolithic inline script path with modular app code under `src/web/app/*` for views, state handling, and shared utilities.

### Changed
- **Web shell and routing integration**: updated server/static wiring and web entry assets to serve compiled app and styles as first-class artifacts.
- **Dashboard interaction polish**: consistent status/action affordances, improved loading and empty states, stronger keyboard support, and improved responsive table behavior.

### Fixed
- **Accessibility baseline**: improved skip-link and landmark navigation, modal focus management, keyboard row expansion behavior, and contrast/focus handling across key views.

---

## [0.2.8] — 2026-03-27

### Added
- **Provider-agnostic runtime registry**: new `AgentRuntime` interface and `RuntimeRegistry` that allows multiple execution backends (CLI, Claude Agent SDK, OpenAI Agents SDK) to coexist behind a single dispatch surface. The existing CLI executor is wrapped as `CliRuntime`, the baseline registered runtime.
- **Claude Agent SDK runtime**: first native SDK provider (`ClaudeAgentSdkRuntime`) activated behind the `HB_TIER2_CLAUDE=1` feature flag. Supports session resume, usage tracking, and governance policy enforcement.
- **Session persistence for SDK runs**: new `sdk_sessions` table stores resumable session state per issue-agent pair so SDK-based runtimes can restore context across heartbeats. Sessions include provider session ID, state blob, and event sequence tracking.
- **Governance policy engine**: provider-agnostic `GovernancePolicyEngine` enforces tool deny/approval policies consistently across CLI and SDK runtimes. Creates approval records for tools requiring pre-execution approval.
- **Runtime configuration on agents**: agents now support `runtime`, `model`, `tools_json`, `disallowed_tools_json`, `approval_required_json`, `max_budget_usd`, and `resume_enabled` columns for SDK runtime selection and governance configuration.
- **Config validation**: `validateRuntimeConfig()` validates runtime-specific requirements (CLI needs `commandTemplate`, SDK needs `model`), detects tool list conflicts, and ensures `approvalRequired` is a valid subset of allowed tools.
- **Runtimes API endpoint**: `GET /api/runtimes` returns available runtimes and feature flag status.
- **Runtime dependencies wiring**: `createRuntimeDependencies()` builds the concrete governance, session, budget, and run event dependencies from the SQLite database.
- **Comprehensive test suite**: 10+ new tests covering runtime registry, config validation, governance engine, session persistence, migration v9, and bootstrap.
- Database migration v9 adds `sdk_sessions` table and runtime config columns to agents.

---

## [0.2.7] — 2026-03-27

### Added
- **Run event persistence and streaming**: run events are persisted to the database and streamable via SSE so clients get live execution updates without polling
- **Approval checkpoints and budget tracking**: agents can declare approval-required operations; budgets are tracked per agent/run with auto-pause at threshold; operators review and approve or deny via the web UI approvals tab
- **Web UI — approvals tab, live runs, cost signals**: new Approvals tab for reviewing pending checkpoints; live run view shows active executions with tool timelines and approval waits; cost signals surface budget consumption inline
- **Policy/config validation for tool permissions**: startup validates agent policy files, rejects unknown tool names, and enforces approval-required operation declarations before any run begins
- **Run history tracking**: new `runs` table records every task execution independently, so a task retried three times shows three distinct run records with their own stdout, stderr, exit codes, and timing
- **Runs API**: `GET /api/runs` (filterable by `task_id`, `agent`, `status`) and `GET /api/runs/:id` replace the former placeholder endpoint; `GET /api/tasks/:id/runs` lists runs for a specific task
- **Runs view in web UI**: dashboard tab shows all execution runs with expandable detail rows for stdout/stderr, commit hash, workspace, and duration
- **Task retry/requeue**: `POST /api/tasks/:id/retry` resets failed or cancelled tasks back to `todo` for re-execution; retry button appears in the task detail panel for eligible tasks
- **YAML export**: `heartbeat export [file]` CLI command dumps agents, tasks, and projects as YAML for backup or bootstrapping new setups
- **Agent-project relationships**: `GET/POST /api/agents/:id/projects` and `DELETE /api/agents/:id/projects/:projectId` link agents to projects with configurable roles (`contributor`, `lead`, etc.)
- Database migration v5 adds `runs` and `agent_projects` tables

---

## [0.2.5] — 2026-03-26

### Added
- Agent details page in the web UI: clicking any agent row in the Agents view expands an inline panel showing metadata, description, soul document, and the full list of assigned tasks with status and priority badges
- `heartbeat agents list` (alias: `ls`) CLI subcommand to enumerate all configured agents with their IDs, types, heartbeat status, and next scheduled run — making `agents show <id>` discoverable

---

## [0.2.4] — 2026-03-26

### Added
- `heartbeat agents show <agent>` and `details` alias for inspecting an agent plus its assigned issues
- Task dependency tracking so blocked tasks can wait on other tasks and resume automatically once blockers resolve
- Runtime URL and port reporting in `heartbeat start` and `heartbeat status`

### Fixed
- Unassigned `todo` tasks no longer fail immediately in the executor before an agent is set
- Existing tasks can be reassigned later without losing the ability to execute them
- Migration history stays append-only while preserving the dependency ledger introduced during `0.2.4` development

---

## [0.2.3] — 2026-03-26

### Added
- Workflow-aware task states including `in_review`, `blocked`, `failed`, and `cancelled` for richer operator handoff flows
- Task comments and review notes in the API and dashboard so status changes carry context instead of only raw state changes
- Release checklist and migration documentation for safer repeatable HeartBeat releases

### Fixed
- Dashboard polling now continues through review and blocked states so the new workflow remains operable in the UI
- Task workflow validation now rejects invalid review-note drift and terminal-task cancellation edge cases

---

## [0.2.2] — 2026-03-19

### Added
- `heartbeat restart` command — stops and starts the daemon in one step

---

## [0.2.1] — 2026-03-19

### Added
- **Hire Agent** — new flow to create agents with AI-generated personas via Claude Code. Generates 5 diverse CEO candidates with avataaars avatars, names, and personality descriptions. User picks one, HeartBeat generates a full SOUL.md document for that agent.
- **Agent SOUL.md** — each hired agent has an identity document (values, decision framework, communication style) that is included as context on every task execution

### Fixed
- Task execution now works correctly for Claude Code agents — prompt is passed via stdin to avoid shell quoting issues
- Hired agents now have correct `command_template` (`claude --print`) with prompt injected properly
- SOUL.md context is automatically prepended to task prompt when agent has one

---

## [0.2.0] — 2026-03-19

### Added
- **Session history per project** — expandable project rows show Claude Code sessions: last active, message count, first message preview (#1)
- **Token usage & cost estimation** — input/output/cache tokens aggregated per project with estimated USD cost (#2)
- **Tool usage breakdown** — horizontal bar chart of Read/Write/Edit/Bash/Agent usage per project (#3)
- **Hot files** — top 10 most-accessed files per project ranked by Read+Write+Edit operations (#4)
- **Global timeline** — date-grouped activity log from `~/.claude/history.jsonl` showing which projects were active each day (#5)
- **Activity heatmap** — GitHub-style contribution heatmap (90 days) in the Timeline tab (#6)

---

## [0.1.5] — 2026-03-19

### Added
- **Projects** — new first-class concept in HeartBeat
- **Scan Machine** — `POST /api/projects/scan` scans `~/.claude/projects/` and imports Claude Code projects automatically
- `source` field on projects: `claude_code` (imported) or `manual` (created by you) — extensible for `codex` etc. in the future
- Projects tab in the UI with scan button, project list, source badges, and manual add form

### Fixed
- Project path double-slash bug in Claude Code directory name parser

---

## [0.1.4] — 2026-03-19

### Fixed
- `heartbeat init` no longer crashes on installed binary — sample config is now embedded inline instead of read from `examples/heartbeat.yaml` via `new URL()`

### Changed
- Release workflow is now **manual** (`workflow_dispatch`) — no more accidental releases on every tag push. To release: go to GitHub Actions → Release → Run workflow → enter version number

---

## [0.1.3] — 2026-03-19

### Fixed
- Web UI now loads correctly when running the installed binary — HTML was not being embedded during `bun build --compile`, causing `ENOENT: /$bunfs/web/index.html` on every request

---

## [0.1.2] — 2026-03-19

### Fixed
- Version number now correctly reported by `heartbeat --version` after install and update
- Post-install PATH instructions made clearer — script now prints `source ~/.zshrc` (or equivalent) prominently

### Changed
- Install script served from `eduardocruz.com/heartbeat.sh`; binaries downloaded from GitHub Releases

---

## [0.1.1] — 2026-03-19

### Added
- **CLI binary** with `start`, `stop`, and `update` commands
- **Self-update** (`heartbeat update`) — downloads latest binary from GitHub Releases
- **Background daemon** — `heartbeat start` runs the server detached, `heartbeat stop` shuts it down cleanly
- **Shell auto-install** — installer detects shell (zsh/bash/fish) and adds `~/.local/bin` to PATH automatically
- **GitHub Actions release workflow** — build and publish binaries for linux-x64, darwin-arm64, and darwin-x64
- `CONTRIBUTING.md` documenting build, release, and install flows

### Changed
- Install script (`install.sh`) now downloads binaries from GitHub Releases instead of a hosted server
- `package.json` updated with `build:cli:*` scripts for cross-compilation

---

## [0.1.0] — 2026-03-19

### Added
- Initial public release
- Cron scheduler with agent heartbeat management
- Task and agent management REST API
- SQLite schema with task/agent CRUD
- Web UI for task and agent management
- Git workspace execution with commit hash tracking
- Executor: runs pending tasks and exposes status API
- CLI commands and runtime status wiring
- Tier 2 SDK integration architecture design
- Curl install command (`curl -fsSL https://eduardocruz.com/heartbeat.sh | bash`)
- Initial Bun + Hono + React scaffold
