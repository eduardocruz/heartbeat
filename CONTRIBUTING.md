# Contributing & Development

## Project Structure

```text
heartbeat/
├── src/
│   ├── server/        # Hono app and API routes
│   ├── cli/           # CLI binary and daemon lifecycle commands
│   ├── executor/      # Task execution and scheduler logic
│   ├── db/            # SQLite schema and migrations
│   ├── projects/      # Claude Code scanning and analytics helpers
│   ├── web/           # Embedded dashboard HTML
│   └── index.ts
├── docs/
│   └── architecture-tier2.md
├── scripts/
│   └── build-release.sh  # Cross-compile release binaries
├── .github/
│   └── workflows/
│       └── release.yml   # Manual GitHub Release workflow
├── install.sh         # Installer for published binaries
└── package.json
```

## Running locally

```bash
bun install
bun run dev          # Start server directly
bun run start        # Start via CLI and daemon manager
bun run typecheck
bun test
```

## Building the CLI binary

```bash
# Single platform (current)
bun build --compile src/cli/index.ts --outfile dist/heartbeat

# All platforms (cross-compile)
bash scripts/build-release.sh
```

Outputs: `dist/heartbeat-linux-x64`, `dist/heartbeat-darwin-arm64`, `dist/heartbeat-darwin-x64`

## Releasing a new version

Follow the full runbook in [`docs/release-checklist.md`](./docs/release-checklist.md). The short version is:

1. Run `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test`
2. Decide how to finish the approved branch. Default: open a PR once the branch is reviewed and verified
3. Make the ticket handoff explicit: `in_review` only when a named reviewer/releaser can act next, `todo` when implementation returns to engineering, `blocked` when an external dependency is stopping progress
4. If the approved diff already lives on an engineer branch, release engineering opens the PR by default unless repo policy says otherwise
5. Escalate ambiguous finish-path decisions to the release owner/CEO instead of leaving the ticket in `in_progress`
6. Validate DB boot/migration behavior and smoke test the daemon
7. Build release binaries with `bash scripts/build-release.sh`
8. Bump `package.json` and update `CHANGELOG.md`
9. Commit the release prep, for example `git commit -am "chore: bump to v0.2.3"`
10. Push `main` and the version tag or run the manual GitHub Release workflow, depending on the current repo release policy

If you need to create the tag locally first:

```bash
git tag v0.2.3
git push origin v0.2.3
```

Users running `heartbeat update` download the latest binary from GitHub Releases.

## Install script

`install.sh` at repo root installs the latest published binary:

```bash
curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
```

It:

1. Detects OS + arch (`linux-x64`, `darwin-arm64`, `darwin-x64`)
2. Downloads the matching GitHub Release asset
3. Installs to `/usr/local/bin` when writable, otherwise `~/.heartbeat/bin`
4. Adds the install directory to PATH in the detected shell profile when needed

To install a specific version:

```bash
HEARTBEAT_VERSION=v0.2.2 curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
```

## GitHub token requirements

The release workflow uses `GITHUB_TOKEN` (automatic, no setup needed).
Permissions: `contents: write` (set in `release.yml`).

## Self-update flow (`heartbeat update`)

- Resolves the latest GitHub Release for the current platform
- Downloads a replacement binary to a temp file
- Marks it executable and atomically swaps it into place
- Requires write permission to the installed binary path
