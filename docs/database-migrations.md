# Database Migrations

HeartBeat now treats SQLite schema changes as an explicit, versioned migration stream instead of a best-effort bootstrap script.

## Rules

- Add a new numbered migration in [`src/db/migrations.ts`](../src/db/migrations.ts) for every schema or data transition.
- Do not rewrite old migration bodies after they ship. New behavior belongs in a new migration.
- Keep migrations idempotent enough for local recovery, but rely on the recorded version history in `schema_migrations` for normal execution.
- Prefer additive or backfill-safe changes. If a change is destructive or not backward compatible, ship a recovery plan before release.

## Current Migration Sequence

1. `bootstrap_core_tables`
   Creates the baseline `tasks`, `agents`, and `projects` tables for fresh installs.
2. `add_workflow_tables_and_columns`
   Adds `task_comments`, task review metadata, timeout support, and newer agent metadata columns.
3. `normalize_task_workflow_statuses`
   Upgrades legacy task states (`pending`, `assigned`, `running`) to workflow-aware states used by `0.2.x`.

## Verification Expectations

- Fresh database boot should apply all migrations and leave three rows in `schema_migrations`.
- Opening an older on-disk database should migrate it in place without manual cleanup.
- Tests for both fresh boot and upgrade paths belong in [`tests/db.test.ts`](../tests/db.test.ts).
- Release verification should include at least one restart against an existing database path so migrations run on a real file, not just `:memory:`.
