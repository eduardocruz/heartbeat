# Changelog

All notable changes to HeartBeat are documented here.

## [0.1.1] — 2026-03-19

### Added
- **CLI binary** with `start`, `stop`, and `update` commands
- **Self-update** (`heartbeat update`) — downloads latest binary from GitHub Releases
- **Background daemon** — `heartbeat start` runs the server detached, `heartbeat stop` shuts it down cleanly
- **Shell auto-install** — installer detects shell (zsh/bash/fish) and adds `~/.local/bin` to PATH automatically
- **GitHub Actions release workflow** — pushing a `v*` tag builds and publishes binaries for all 3 platforms (linux-x64, darwin-arm64, darwin-x64) automatically
- `CONTRIBUTING.md` documenting build, release, and install flows

### Changed
- Install script (`install.sh`) now downloads binaries from GitHub Releases instead of a hosted server
- `package.json` updated with `build:cli:*` scripts for cross-compilation

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
