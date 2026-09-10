---
description: Start or update a durable free-form text artifact
argument-hint: "<topic or artifact path>"
---

Treat "$@" as a topic for the canonical text-memory workspace under `PA_DATA_DIR/notes/`.

1. Use `pa_retrieve_context` first for a personal-context question, then search existing artifacts with `pa_search_notes` when needed.
2. Preserve existing prose, ordinary links, and useful source references when a matching artifact exists.
3. Choose the simplest human-readable Markdown, Org, or plain-text artifact. It may be a note, wiki page, task tracker, checklist, decision log, project page, research page, or another ordinary text file.
4. Put facts, unknowns, decisions, sources, correspondence, and Markdown checkboxes in the text itself.
5. Assistant-owned memory create, rewrite, and append operations may be performed directly with `pa_create_note`, `pa_write_note`, or `pa_append_note`; no per-write confirmation is needed. Report the path and a concise description of what was stored or changed.

Do not create opaque IDs, formal artifact schemas, database-only meaning, or external reminders. Keep separate confirmation gates for legacy migration, importing user-selected documents, document rename/move/tag proposals, deletion, and external or high-impact actions.
