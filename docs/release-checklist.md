# Release Checklist

Use this checklist before shipping a HeartBeat release. It is written for the current `0.2.x` architecture: Bun CLI, SQLite persistence, local daemon state, and GitHub Releases for binary distribution.

## 1. Preflight

- Confirm the release branch has already passed review and is ready to merge or tag.
- Ensure the working tree is clean before preparing release commits:

  ```bash
  git status --short
  ```

- Install dependencies and run the baseline verification suite:

  ```bash
  bun install --frozen-lockfile
  bun run typecheck
  bun test
  ```

- Update release metadata before tagging:
  - `package.json` version
  - `README.md` current version if it changed
  - `CHANGELOG.md` entry for the target version

## 2. Database Migration Verification

HeartBeat migrations run automatically from [`src/db/migrations.ts`](../src/db/migrations.ts) whenever the daemon opens the SQLite database. The migration policy and current version history are documented in [`docs/database-migrations.md`](./database-migrations.md).

- Review migration changes for the release. Add a new numbered migration for every schema transition instead of editing a previously shipped step.
- Verify a clean boot against a fresh database:

  ```bash
  tmpdir="$(mktemp -d)"
  HEARTBEAT_DB_PATH="$tmpdir/heartbeat.db" PORT=4410 bun run start
  bun run src/cli/index.ts stop
  rm -rf "$tmpdir"
  ```

- Verify startup against an existing database path so migrations execute in-place:

  ```bash
  tmpdir="$(mktemp -d)"
  export HEARTBEAT_DB_PATH="$tmpdir/heartbeat.db"
  PORT=4410 bun run start
  bun run src/cli/index.ts stop
  PORT=4410 bun run start
  bun run src/cli/index.ts stop
  rm -rf "$tmpdir"
  ```

- If schema behavior changed, add or update tests in [`tests/db.test.ts`](../tests/db.test.ts) before shipping.

## 3. CLI Packaging Verification

Published installs depend on the compiled CLI binaries and the updater/install script behavior.

- Build all release binaries:

  ```bash
  bash scripts/build-release.sh
  ```

- Verify the expected artifacts exist:
  - `dist/heartbeat-darwin-arm64`
  - `dist/heartbeat-darwin-x64`
  - `dist/heartbeat-linux-x64`

- Smoke-check the Linux binary locally:

  ```bash
  ./dist/heartbeat-linux-x64 --version
  ./dist/heartbeat-linux-x64 init
  ```

- Confirm the release asset naming still matches the updater and installer expectations in [`src/cli/update.ts`](../src/cli/update.ts) and [`install.sh`](../install.sh):
  - asset prefix `heartbeat-`
  - supported platforms `darwin-arm64`, `darwin-x64`, `linux-x64`

- If packaging changes touched CLI commands, re-run a few core commands from a compiled binary:

  ```bash
  ./dist/heartbeat-linux-x64 --help
  ./dist/heartbeat-linux-x64 status || true
  ```

## 4. Smoke Test Expectations

Run one end-to-end local smoke pass from source before tagging:

```bash
PORT=4410 bun run start
bun run src/cli/index.ts status
curl -fsS http://127.0.0.1:4410/api/executor/status
curl -fsS http://127.0.0.1:4410/api/projects
bun run src/cli/index.ts stop
```

Minimum expected outcomes:

- the daemon starts and writes runtime state without crashing
- `heartbeat status` reports a live process
- the HTTP server responds on the configured port
- the executor status endpoint returns JSON
- the projects endpoint responds successfully even with no imported projects

If the release changes install or update flows, also test:

```bash
bash install.sh
heartbeat update
```

Use a disposable environment when checking installer or updater behavior.

## 5. Ship

After verification completes:

1. Merge the approved branch into `main`, or keep the branch open if release timing requires it.
2. Create the release commit that bumps versioned files.
3. Tag the release:

   ```bash
   git tag v0.2.3
   git push origin main --tags
   ```

4. Confirm GitHub Actions publishes the three binaries and release notes from `CHANGELOG.md`.

## 6. Post-Release Checks

- Verify the GitHub Release contains all three compiled binaries.
- Confirm `heartbeat update` resolves the new tag.
- Confirm the install command downloads the new version:

  ```bash
  HEARTBEAT_VERSION=v0.2.3 curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
  ```

- Record any release-only issues immediately in a follow-up ticket instead of leaving tribal knowledge undocumented.

## 7. Rollback Notes

- If a tag is bad before users adopt it widely, remove the Git tag and GitHub Release, then cut a fixed patch version.
- Avoid mutating published binaries in place. Publish a new version instead.
- If a migration is not backward compatible, stop the release and add an explicit migration or recovery plan before retrying.
