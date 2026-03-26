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
3. Validate DB boot/migration behavior and smoke test the daemon
4. Build release binaries with `bash scripts/build-release.sh`
5. Bump `package.json` and update `CHANGELOG.md`
6. Commit the release prep, for example `git commit -am "chore: bump to v0.2.3"`
7. Push `main` and the version tag
8. Let the tag-triggered GitHub `Release` workflow publish the binaries and release notes

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
