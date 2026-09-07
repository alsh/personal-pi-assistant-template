# Changelog

## Unreleased — Distributable Pi package layout

- Moved extension code, skills, prompts, and synthetic-default configuration to top-level package resources.
- Added a valid Pi package manifest with the `pi-package` keyword and peer declarations for Pi-bundled imports.
- Removed package-local Pi settings and installed resources; use `pi -e` for a temporary load or `pi install` from a separate consumer.
- Added package-layout, no-`.pi`, isolated synthetic-data, and Pi smoke checks.

## 0.3.0 — Portable note workspace

- Replaced the ticket-like case/task/research-record workflow with a Zettelkasten-style free-form note workspace.
- Added canonical Markdown/Org/text notes with human-readable paths and direct file search.
- Made the SQLite database a disposable derived cache; notes remain readable and searchable after cache deletion and rebuild.
- Added a portable redacted `audit.ndjson` log and serialized confirmation prompts to prevent concurrent tool-call hangs.

## 0.2.0 — Historical structured research layer

- Added an earlier structured research-evidence layer; it is no longer the normal user-facing workflow.

## 0.1.0 — Stage 1 template

- Local-only document indexing, bounded extraction, hashes, metadata, duplicate detection, stale-source detection, and redacted audit events.
- Confirmation-gated document rename/move/tag proposals.
- User-confirmed import of external local documents into private storage.
- Synthetic fixtures, schemas, skills, prompts, policy checks, permission checks, and offline tests.
- No remote connector, public sharing, banking, health, or calendar write integration.
