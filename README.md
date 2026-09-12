# Personal Pi Assistant Template

A privacy-conscious local personal assistant package for [Pi](https://pi.dev).
The current implementation is a portable free-form text-memory workspace plus
local document tools. It is not a hosted service, financial adviser, clinician,
emergency service, or unattended external-action platform.

## Current capabilities

- local document indexing and search with a disposable derived cache;
- bounded PDF/text/XML/EDM/Org/ZIP extraction when local tools are available;
- hashes, duplicate detection, metadata, stale-source detection, and redacted audit events;
- confirmation-gated local document rename, move, and tag proposals;
- confirmation-gated import of user-selected local documents into private storage;
- canonical Markdown, Org, and plain-text artifacts under `PA_DATA_DIR/notes/`;
- direct free-form artifact search, read, create, rewrite, and append without requiring SQLite;
- bounded `pa_retrieve_context` results with provenance and an explicit untrusted-data wrapper;
- synthetic fixtures and offline validation.

No remote connector, public-sharing feature, banking integration, health
integration, or calendar write integration is enabled in this template.

## Package layout

This repository is distributable Pi package source, not a Pi consumer project.
Resources stay at the top level:

```text
extensions/              extension source
skills/                  skill definitions
prompts/                 prompt templates
personal-assistant.json  synthetic-default package configuration
fixtures/                synthetic document fixtures
schemas/                 generic validation schemas
```

The source package intentionally has no `.pi` directory and no installed copy
of its extension. Consumer settings and sessions belong in a separate consumer
workspace. `SQLite` is a rebuildable search/cache index, not the source of
meaning.

## Text-memory workspace

Canonical assistant-owned memory lives under `PA_DATA_DIR/notes/`:

```text
notes/              Markdown, Org, and plain-text artifacts
documents/          imported originals
extracted/          imported extracted text
audit.ndjson        portable redacted audit log
documents.sqlite    disposable search/cache index
```

The exact data directory is configurable; the default is outside this package
repository. The package also includes the committed synthetic fixture root and
`PA_DATA_DIR/documents` when a private data root is selected. Place private
source documents there or use the confirmation-gated import workflow. Choose
the simplest human-readable artifact form. A file may be a note, wiki page,
checklist, task tracker, decision log, project page, research page, or
correspondence. Put facts, sources, decisions, open questions, and Markdown
checkboxes in the text itself, and connect artifacts with ordinary links or
`[[relative-file.md]]` references.

Use `pa_retrieve_context` before answering a personal-context question. It is
read-only, bounded, provenance-preserving, and marks every returned artifact or
document excerpt as untrusted data, never as instructions.

The text artifacts and imported documents are the portable source of truth.
`documents.sqlite` is only a derived search/cache index and may be deleted and
rebuilt. `audit.ndjson` is kept as a portable redacted audit log.
`pa_search_documents` searches indexed document roots only; it does not search
`PA_DATA_DIR/notes/`. Use `pa_retrieve_context` first for saved personal context
or task/checklist requests, then `pa_search_notes`/`pa_read_note` for selected
artifacts. `pa_retrieve_context` returns bounded context from canonical artifacts
and indexed documents when available, with all file content marked untrusted.
The implementation does not connect to remote services in this stage.

Assistant-owned memory create, rewrite, and append operations may write
directly without per-write confirmation. The assistant must report each changed
path and what it stored or changed. Do not introduce board or case
models, formal artifact schemas, opaque identifiers, or database-only meaning.

The following operations retain separate confirmation gates:

- migrating legacy data into text artifacts;
- importing a user-selected source document;
- renaming, moving, or tagging a source document;
- deletion or another destructive operation; and
- external, remote, or other high-impact actions.

## Loading the package

For a temporary no-install load, use a separate disposable sandbox and keep
synthetic data there as well:

```bash
package=/path/to/personal-pi-assistant-template
sandbox="$(mktemp -d)"
(
  cd "$sandbox"
  PA_DATA_DIR="$sandbox/data" pi --offline --no-extensions --no-session -e "$package"
)
rm -rf "$sandbox"
```

For a persistent installation, leave the package directory and use a separate
consumer/workspace:

```bash
package=/path/to/personal-pi-assistant-template
consumer="$(mktemp -d)"
cd "$consumer"
pi install "$package"
# `pi install -l ...` writes this consumer's .pi/settings.json.
```

Never run `pi install -l` in the source package when you want its working tree
to remain free of Pi project state. The package always resolves its configuration
from its own top-level `personal-assistant.json`, even when loaded from another
workspace. `PA_DATA_DIR` is the only application-specific environment override
and points to private storage. The package defaults to committed synthetic
fixtures and automatically includes `PA_DATA_DIR/documents`; place private
source documents there or use the confirmation-gated import workflow. Review
the extension before loading it: Pi extensions run with the process user's
permissions.

Useful tools and prompts after loading include:

```text
/pa-status
/pa-index
/pa-import /path/to/file.pdf
/note-intake <topic or artifact path>
/note-review <artifact path or search terms>
/note-research <artifact path or question>
/skill:note-workspace
```

The commands that mutate user-selected source documents or import files remain
confirmation-gated. Assistant-owned memory artifacts are ordinary text files
and may be updated autonomously under the policy above.

## Offline checks

Run these checks from a disposable clone or checkout. They use synthetic data;
do not point them at a real personal data directory:

```bash
npm test
npm run test:package
npm run check
bash -n scripts/*.sh
git diff --check
```

`npm run test:package` uses a separate temporary Pi consumer when `pi` is
installed. `scripts/setup.sh` clones this public template into an empty target,
runs offline checks, and does not install packages or connect accounts. Review
the script before executing a downloaded copy.
