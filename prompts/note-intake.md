---
description: Start or update a free-form personal note
argument-hint: "<topic or note path>"
---

Treat "$@" as a topic for the local Zettelkasten-style note workspace.

1. Search existing notes with pa_search_notes.
2. Preserve existing prose and links when a matching note exists.
3. Otherwise propose a human-readable Markdown or Org path and free-form content.
4. Put facts, unknowns, decisions, sources, correspondence, and Markdown checkboxes in the note itself.
5. Ask for confirmation before pa_create_note, pa_write_note, or pa_append_note.

Do not create cases, tasks, UUIDs, formal statuses, or database-only metadata.
