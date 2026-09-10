# Changelog

## Unreleased — Autonomous text memory and bounded context

- Generalized the canonical `PA_DATA_DIR/notes/` workspace to free-form Markdown, Org, and plain-text artifacts, including wiki pages, checklists, decisions, projects, and research.
- Allowed assistant-owned memory create, rewrite, and append operations without per-write confirmation while retaining separate gates for imports, source-document changes, legacy migration, deletion, and external or high-impact actions; writes report changed paths.
- Added per-file mutation queues and atomic replacement so concurrent appends do not lose content.
- Added `pa_retrieve_context` for bounded, provenance-preserving, explicitly untrusted context from canonical artifacts and indexed documents.
- Updated status, prompts, skills, policy, consent, package metadata, and synthetic tests for the revised boundary.

## 0.3.0 — Portable text workspace

- Replaced the ticket-like structured workflow with a free-form text workspace.
- Added canonical Markdown, Org, and plain-text artifacts with human-readable paths and direct file search.
- Made the SQLite database a disposable derived cache; text artifacts remain readable and searchable after cache deletion and rebuild.
- Added a portable redacted `audit.ndjson` log and serialized confirmation prompts for gated local document mutations.

## 0.1.0 — Stage 1 template

- Added local-only document indexing, bounded extraction, hashes, metadata, duplicate detection, stale-source detection, and redacted audit events.
- Added confirmation-gated local document rename, move, and tag proposals.
- Added user-confirmed import of external local documents into the private data store.
- Added synthetic fixtures, schemas, skills, prompts, policy checks, permission checks, and offline tests.
- Added a valid Pi package manifest with top-level extensions, skills, and prompts.
- No remote connector, public sharing, banking, health, or calendar write integration is included.
