# Personal Pi Assistant Template

A privacy-conscious local personal assistant project for [Pi](https://pi.dev).

## Current capabilities

- local document indexing/search with a disposable derived cache;
- PDF/text/XML/EDM/Org/ZIP extraction;
- hashes, duplicate detection, metadata, and stale-source detection;
- confirmation-gated document rename/move/tag proposals;
- importing user-selected local documents into private storage;
- a portable Zettelkasten-style note workspace using Markdown, Org, and text files;
- direct note search/read/write/append without requiring SQLite;
- synthetic fixtures and offline validation.

The template has no active Google Drive, pCloud, calendar, health, finance, banking, or public-sharing connector.

## Anonymous setup

The repository is public, so no GitHub authentication is needed. Review the script at the URL before executing it:

```bash
cd /path/to/empty-folder
curl -fsSL https://raw.githubusercontent.com/alsh/personal-pi-assistant-template/main/scripts/setup.sh | bash
```

The script sets up the current directory by default and refuses non-empty directories. For a review-first run, download it to a temporary file, inspect it, and execute it without a target argument while remaining in the target directory.

## Local usage

```bash
cd /path/to/empty-folder
./scripts/doctor.sh
npm test
npm run check
```

Restart Pi, review project trust, and run it with an explicitly selected private document root:

```bash
PA_DOCUMENT_ROOTS="$HOME/Documents/selected-folder" pi
```

Useful commands and prompts:

```text
/pa-status
/pa-index
/pa-import /path/to/document.pdf
/note-intake <topic>
/note-review <note path or search terms>
/note-research <note path or question>
/skill:note-workspace
```

## Note workspace

Repairs, applications, correspondence, research, and household topics are ordinary human-readable Markdown/Org notes, not cases or tickets. Put facts, sources, decisions, questions, and Markdown checkboxes in the note text. Connect notes with normal Markdown links or `[[note-name.md]]` references.

Canonical data lives under the private data directory, normally `~/.local/share/personal-assistant/`:

```text
notes/              canonical free-form notes
documents/          imported originals
extracted/          imported extracted text
audit.ndjson        portable redacted audit log
documents.sqlite    disposable search/cache index
```

The SQLite file may be deleted and rebuilt. Copy the data directory to another machine and set `PA_DATA_DIR` to its new location if necessary; the note files remain sufficient to continue.

If a data directory comes from an older structured version, run the one-time `pa_migrate_legacy_notes` tool before deleting its old cache. It requires confirmation.

Never place real personal documents, credentials, browser data, medical data, bank data, or Pi sessions in the repository.
