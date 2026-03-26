# Release Checklist

Use this checklist before shipping a HeartBeat release. It is written for the current `0.2.x` architecture: Bun CLI, SQLite persistence, local daemon state, and GitHub Releases for binary distribution.

## 1. Preflight

- Confirm the release branch has already passed review and is ready to merge or tag.
- Confirm the ticket that owns the release work also has an explicit next owner. Approved work must never sit in `in_progress` without a named actor or blocker.
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

- Choose the completion path for the approved branch before tagging or merging:
  - `Create a pull request` is the default once review and verification are complete.
  - `Merge locally` only when the repo policy already allows direct local merges or a human explicitly asks for it.
  - `Keep the branch as-is for later` only when release timing, a dependency, or product direction requires delay. Record the owner and reason in the handoff.
  - `Discard the branch` only when the work is superseded or no longer needed.
- Do not block approved work solely because nobody picked among the routine source-control options above. If the branch is approved, verified, and still needed, open the PR and hand off the merge/release follow-up there.

- Update release metadata before tagging:
  - `package.json` version
  - `README.md` current version if it changed
  - `CHANGELOG.md` entry for the target version

## 2. Release Handoff Rules

Use these workflow rules for release-stage tickets once the code diff is approved:

- Leave the ticket in `in_review` only when the next action belongs to a specific reviewer or release approver who can complete the current step without sending the work back for more implementation.
- Move the ticket back to `todo` when implementation or verification must return to an engineer. Add a handoff note that names the missing work.
- Move the ticket to `blocked` when no assigned actor can proceed because approval, credentials, repo permissions, or product direction are missing. The blocker comment must say who needs to act next.
- Do not leave a release ticket in `in_progress` as a parking state. `in_progress` means the current assignee is actively executing the next step now.

Ownership for source-control completion:

- If the approved diff already exists on an engineer branch, release engineering owns opening the PR by default. Do not wait for the original engineer unless the repo policy explicitly requires it.
- Use `Merge locally` only when direct local merge/tagging is already authorized for the repo or a human explicitly asks for that path.
- If the finish path is unclear but the work is approved, the CEO chooses one of the standard completion paths: `Create a pull request`, `Merge locally`, `Keep the branch as-is for later`, or `Discard the branch`.
- Once the CEO selects `Keep the branch as-is for later` or `Discard the branch`, record the reason and new owner immediately in the ticket or release handoff note.

Minimum handoff comment for every release-stage ticket:

- current status and chosen finish path
- branch or PR link
- named next owner
- exact blocker or remaining step, if any

## 3. Database Migration Verification

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

## 4. CLI Packaging Verification

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

## 5. Smoke Test Expectations

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

## 6. Ship

After verification completes:

1. Finish the approved development branch using one of these paths:
   - `Create a pull request` for merge/release follow-up. This is the default path.
   - `Merge locally` when direct local merge is already approved for this repo or release.
   - `Keep the branch as-is for later` when timing or dependencies require waiting. Record why the branch remains open.
   - `Discard the branch` when the approved work should not ship after all.
2. Update the release-stage ticket so the owner and next step match the chosen path:
   - `Create a pull request`: keep the ticket in `in_review` only if a named reviewer/releaser can act next; otherwise assign the PR creation work and keep it `in_progress` for that owner until the PR exists.
   - `Merge locally`: keep it `in_progress` for the person performing the merge/tag until they finish or hit a blocker.
   - `Keep the branch as-is for later`: move the ticket out of `in_progress`, name the future owner, and explain the wait condition.
   - `Discard the branch`: close the ticket with the discard reason so the branch does not remain ambiguous.
3. If the work is shipping now, create the release commit that bumps versioned files.
4. Tag the release:

   ```bash
   git tag v0.2.3
   git push origin main --tags
   ```

5. Confirm GitHub Actions publishes the three binaries and release notes from `CHANGELOG.md`.

## 7. Post-Release Checks

- Verify the GitHub Release contains all three compiled binaries.
- Confirm `heartbeat update` resolves the new tag.
- Confirm the install command downloads the new version:

  ```bash
  HEARTBEAT_VERSION=v0.2.3 curl -fsSL https://raw.githubusercontent.com/eduardocruz/heartbeat/main/install.sh | bash
  ```

- Record any release-only issues immediately in a follow-up ticket instead of leaving tribal knowledge undocumented.

## 8. Rollback Notes

- If a tag is bad before users adopt it widely, remove the Git tag and GitHub Release, then cut a fixed patch version.
- Avoid mutating published binaries in place. Publish a new version instead.
- If a migration is not backward compatible, stop the release and add an explicit migration or recovery plan before retrying.
