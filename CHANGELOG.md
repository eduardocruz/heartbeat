# Changelog

All notable changes to HeartBeat are documented here.

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
