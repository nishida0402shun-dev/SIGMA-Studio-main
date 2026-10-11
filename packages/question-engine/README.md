# SIGMA Question Engine

SIGMA Studio 専用の問題ドメインとアプリケーション契約を提供するパッケージです。SQLite のスキーマ、接続、永続化はこのパッケージの責務ではなく、`packages/sigma-core` が所有します。

## Current boundary

- `src/core/`: question domain types.
- `src/application/contracts.ts`: application-facing ports and contracts.
- `src/index.ts`: public exports for domain and application contracts.
- `src/storage/`: **removed**. The previous Question Engine SQLite implementation is not the new storage foundation.
- The disconnected standalone Question Bank package has also been removed from this branch.

## Storage ownership

The shared database is opened by SIGMA Core as `sigma-core.sqlite` under the application-owned `data/knowledge-db` directory. Electron injects the shared SQLite connection into Core repositories and stores. The database is shared across workspaces.

SIGMA Core owns schema versioning and persistence for questions, knowledge metadata, PDF import staging, vectors, learning feedback, conversation history, long-term memory, and research sessions. Electron continues to own operating-system integration, file selection, PDF extraction and analysis, source-file handling, and archive I/O. The browser runtime's IndexedDB adapter is a separate runtime layer and is not the desktop SQLite implementation.

## Legacy retirement

- Legacy Question Engine `qe_*` tables are dropped by SIGMA Core's schema initializer, including when the database already reports the current schema version.
- The former `sigma-studio.sqlite` file and its `-wal` / `-shm` sidecars are targeted for deletion by the Electron startup cleanup. This documents code behavior; it does not prove that a user's local files have already been removed.
- Old local database rows and old JSON-backed store data are not migrated into the new database. This is the agreed rebuild policy.
- Electron's former learning-feedback and research-session compatibility re-export modules have been deleted; callers import SIGMA Core directly.

## Verification

The current branch's CI must pass typecheck, lint, desktop and Core tests, production build, Electron build/smoke test, and platform-specific file-locking checks before this rebuild is considered verified. A green CI run verifies the checked commit; it does not prove that files have been deleted from every user's machine.

The current status and evidence are tracked in `docs/sigma-core/architecture.md` and `docs/question-engine-db-inventory.md`.
