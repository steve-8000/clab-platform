# Code Intel Runbook

## Register and index a repository

1. Open the dashboard at `/code-intel` and confirm the target repository is listed.
2. If the repository is missing, call `POST /repositories` with `url`, `name`, and `default_branch`.
3. Trigger indexing with `POST /repositories/{repo_id}/index`.
4. Track progress from the repository detail page or by checking the latest row in `ci_graph_builds`.

## Re-index when CGC fails

1. Check `/health` and confirm whether `cgc` is unavailable or the database is degraded.
2. Inspect the latest `ci_graph_builds.error_message` entry for the failed snapshot.
3. Re-run `POST /repositories/{repo_id}/index` with the target `branch`, `commit_hash`, and optional `languages`.
4. If the same revision fails repeatedly, pin the failing snapshot id and preserve the error output before retrying with a known-good CGC build.

## Update the CGC binary

1. Install the new CGC binary on the host used by `apps/code-intel`.
2. Update `CGC_BINARY_PATH` if the install location changed.
3. Restart the code-intel service.
4. Call `/health` and verify `cgc` is `ok` or `available_via_module`.
5. Run a re-index on one small repository before rolling the binary into wider use.

## Fallback when code-intel is down

1. Use the dashboard’s repository list and existing snapshots as read-only references.
2. Fall back to direct repository inspection and the control-plane task context when `context-bundle` is unavailable.
3. If the database is healthy but CGC is down, rely on cached summary, search, impact, and findings data from the latest completed snapshot.
4. If both CGC and the database are unavailable, disable code-intel dependent workflows until `/health` returns a non-degraded status.

## DB schema migration steps

1. Review `apps/code-intel/schema.sql` and prepare the migration in the target PostgreSQL environment.
2. Apply schema changes in a transaction during a maintenance window.
3. Confirm all `ci_*` tables and enum types exist after the migration.
4. Restart the code-intel service and verify `/health`.
5. Trigger a fresh index on at least one repository to validate the schema end to end.

## Monitoring metrics

- Track structured logs for indexing start, completion, fallback warnings, and failures.
- Watch request latency for `/repositories/{repo_id}/summary`, `/symbols/search`, `/impact`, and `/hotspots`.
- Monitor counts of `FAILED` rows in `ci_graph_builds`.
- Track database availability with `/health` and PostgreSQL pool errors.

## Troubleshooting common errors

### `Database connection not available`

- Verify `CODE_INTEL_DB_URL`.
- Confirm PostgreSQL is reachable from the service runtime.
- Restart the service after restoring connectivity.

### `CGC engine not available`

- Verify `CGC_BINARY_PATH` points to an installed binary or Python module-backed adapter.
- Confirm the runtime image includes the `codegraph` package and its dependencies.

### Empty search or hotspot results

- Check whether the repository has a completed snapshot and graph build.
- Re-index the repository if the latest build failed or never completed.

### Missing context bundle or findings

- Confirm the referenced `task_run_id` or `review_id` exists in `ci_context_bundles` or `ci_structural_findings`.
- Validate that the upstream workflow persists those records before the dashboard requests them.
