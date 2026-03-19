# Contributing & Development

## Project Structure

```
heartbeat/
├── src/
│   ├── server/        # HTTP server (agent orchestration platform)
│   ├── cli/           # CLI binary (install, start, stop, update)
│   │   ├── index.ts   # CLI entrypoint (commander)
│   │   ├── update.ts  # Self-update via GitHub Releases
│   │   ├── state.ts   # Daemon state (pid, port)
│   │   └── constants.ts
│   └── index.ts       # Server entrypoint
├── scripts/
│   └── build-release.sh  # Cross-compile all 3 binaries
├── .github/
│   └── workflows/
│       └── release.yml   # CI: build + publish GitHub Release on tag push
├── install.sh         # Curl-pipe installer (downloaded by users)
└── package.json
```

## Running locally

```bash
bun install
bun run dev          # Start server (src/server/index.ts)
bun run start        # Start via CLI
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

1. Bump version in `package.json`
2. Commit: `git commit -am "chore: bump to v0.2.0"`
3. Tag + push:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```
4. GitHub Actions (`.github/workflows/release.yml`) automatically:
   - Installs deps with `bun install --frozen-lockfile`
   - Runs `bash scripts/build-release.sh` (3 binaries)
   - Creates a GitHub Release with the 3 binaries as assets

Users running `heartbeat update` download the latest binary from GitHub Releases.

## Install script

`install.sh` at repo root is the curl-pipe installer:

```bash
curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
```

It:
1. Detects OS + arch (`linux-x64`, `darwin-arm64`, `darwin-x64`)
2. Fetches the latest release from GitHub API
3. Downloads the binary to `~/.local/bin/heartbeat`
4. Adds `~/.local/bin` to PATH in shell config (`.zshrc`, `.bashrc`, or `fish`)

To install a specific version:
```bash
HEARTBEAT_VERSION=v0.1.1 curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
```

## GitHub token requirements

The release workflow uses `GITHUB_TOKEN` (automatic, no setup needed).
Permissions: `contents: write` (set in `release.yml`).

## Self-update flow (`heartbeat update`)

- Calls `https://api.github.com/repos/eduardocruz/heartbeat/releases/latest`
- Finds the asset matching the current platform
- Downloads to a temp file, `chmod +x`, replaces the current binary via `renameSync`
- Requires write permission to the binary location (`~/.local/bin/heartbeat`)
