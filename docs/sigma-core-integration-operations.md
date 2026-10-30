# SIGMA Core integration contract and operations

## Scope and compatibility identity

Studio uses SIGMA Core as a source-material service and read-only AI retrieval
server. Core is **not** the canonical store for SigmaDoc documents, folders,
revisions, recovery files, or shared-workspace editing. Those continue to use
Studio's existing document store; no migration or replacement is implied.

The supported dependency identity is the Git submodule commit recorded at
`vendor/sigma-core` in Studio `main`. The npm workspace link and lockfile make
local builds reproducible, but Core is private and is not published as a Studio
runtime npm package. For this integration, the exact Core Git SHA—not the
internal `0.1.0` package version—is the version identifier.

Core updates are detected by the scheduled/manual `Update SIGMA Core` workflow.
It validates the candidate Core commit, updates the submodule and workspace
lockfile, creates a review PR, and dispatches Studio Checks. It does not merge
the update. A formal Core tag/release trigger and downloadable Core artifacts
are intentionally not used by the source-pinned integration.

## Runtime contract

- Studio bundles its Core bridge and the `sigma-core-local` stdio server into
  the Electron application. MCP clients launch the bundled entrypoint through
  the Electron executable in Node mode; the Studio renderer does not access
  Core's SQLite database directly.
- The database and blobs live under
  `<app.getPath("userData")>/data/sigma-core/` as `core.sqlite` and `blobs/`.
- A Studio workspace ID is mapped to `studio:<id>`. A workspace must be
  explicitly registered; listing or importing does not silently create or
  select one.
- The MCP identity is `studio-ai`. Registration grants that subject read
  access to the selected workspace, not write or delete permission.
- The public MCP tools are `list_source_workspaces`, `list_sources`,
  `search_sources`, `get_source`, `get_source_page`, and
  `get_source_page_range`. They are read-only. Adding a mutation tool requires
  a separately reviewed authorization and recovery design.
- Original file bytes remain available from the source-material service.
  Extraction support is operation- and format-specific; storing or rendering a
  PDF is not proof of accurate OCR or universal document extraction.

The full tool schema, authorization, workspace isolation, source bytes, search,
page retrieval, error behavior, and restart persistence are covered by Studio
unit/integration tests. Windows CI validates both the unpacked app and, in the
installer-validation job, the installed NSIS app. CI success is not a
substitute for a user-machine installation check.

## Update and rollback procedure

1. Review the Core SHA and change summary in the generated Studio update PR.
2. Require the Core checks and the complete Studio Checks workflow to pass.
   Review database migrations and the compatibility contract before merging.
3. Keep the prior Studio commit and its pinned Core SHA available for code
   rollback. Revert the integration update through a reviewed Studio PR; do not
   point a normal build at an unpinned Core branch.
4. A code rollback does **not** roll back a database migration. Core rejects a
   database schema newer than the running Core supports. Never try to downgrade
   the database by opening it with an older build.
5. Before a Core/schema update that may affect data, stop Studio and all MCP
   clients, then copy the entire `data/sigma-core` directory (database and
   blobs) to a protected backup location. Do not copy only `core.sqlite` while
   SQLite is open; the database uses WAL mode. Keep the original directory
   untouched until the updated app has been checked.
6. To restore, stop all clients, preserve the current directory for diagnosis,
   and restore the complete database-plus-blobs snapshot as one unit. Reopen
   only with a Core version compatible with that schema. Verify workspaces,
   source counts, and retrieval before resuming edits.

The encrypted `BackupService` exists in Core but is not currently exposed as a
Studio user-facing backup/restore flow. The copy procedure above is an
operator-managed recovery measure and does not claim that encrypted backups
are automatically created or verified.

## Failure handling and update pause

- If the MCP server is missing or fails to start, report the provider/MCP
  launch error; do not represent a failed query as an empty successful result.
- If an operation reports an authorization or workspace error, select or
  register the intended workspace explicitly. Do not retry by weakening the
  `studio-ai` policy.
- To pause automated Core updates, disable the `Update SIGMA Core` GitHub
  Actions workflow. Re-enable it only after reviewing the candidate and CI
  state. This does not disable already-created update PRs.
- No automatic database downgrade, data deletion, Core update merge, or release
  publication is part of the update workflow.

## Verified and outstanding checks

The Windows CI gate builds `win-unpacked`, verifies the Core MCP round-trip,
builds the NSIS installer with publishing disabled, installs it in the runner,
and runs the same MCP round-trip using the installed executable and `app.asar`.
Studio PR #41 Checks run
[41048216578](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/41048216578)
passed all four jobs, including the NSIS install and installed-app MCP test.
The CI job does not publish installer or release assets.

Still requiring a target-user environment are a manual signed/unsigned
installation check, SmartScreen behavior, confirmation of the actual
user-data path and existing-library preservation, and recovery from an
operator-created backup. These cannot be inferred from GitHub-hosted CI.
