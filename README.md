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

## Pi package layout

This repository is a distributable Pi package, not a Pi consumer project. Package
resources stay at the top level:

```text
extensions/              extension source
skills/                  skill definitions
prompts/                 prompt templates
personal-assistant.json  synthetic-default package configuration
```

The source package intentionally has no `.pi` directory and no installed copy of
its extension. Pi project settings belong to a separate consumer/workspace. The
anonymous `scripts/setup.sh` clone and its checks do not install the package into
itself.

For a temporary, no-install load, run Pi from a separate disposable sandbox and
keep data there as well:

```bash
package=/path/to/personal-pi-assistant-template
sandbox="$(mktemp -d)"
PA_DATA_DIR="$sandbox/data" \
PA_DOCUMENT_ROOTS="$package/fixtures/documents" \
  pi -e "$package" --no-session
rm -rf "$sandbox"
```

For a persistent install, leave the package directory and use a separate
consumer/workspace:

```bash
package=/path/to/personal-pi-assistant-template
consumer="$(mktemp -d)"
cd "$consumer"
pi install "$package"
# `pi install -l "$package"` writes this consumer's .pi/settings.json.
```

Never run the consumer `pi install -l` command in the source package when you
want its working tree to remain free of Pi project state. The package defaults
to the committed synthetic fixtures; set `PA_DOCUMENT_ROOTS` explicitly before
using real local roots, and keep `PA_DATA_DIR` outside the package.

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
npm run test:package
npm run check:policy
PA_DATA_DIR="$(mktemp -d)" npm run check:permissions
bash -n scripts/*.sh
git diff --check
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
