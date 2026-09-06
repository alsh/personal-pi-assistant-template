# Personal Pi Assistant Template

A privacy-conscious local personal assistant project for [Pi](https://pi.dev).

## Current capabilities

- local document indexing/search;
- PDF/text/XML/EDM/ZIP extraction;
- hashes, duplicate detection, basic metadata, and stale-source detection;
- confirmation-gated document rename/move/tag proposals;
- importing a user-selected local file into a private data store;
- private local cases, checklist tasks, due dates, statuses, linked documents, and closure;
- public research evidence notes with bounded citations, confidence, jurisdiction, and case links;
- synthetic fixtures and offline validation.

The template has no active Google Drive, pCloud, calendar, health, finance, banking, or public-sharing connector.

## Anonymous setup

The repository is public, so no GitHub authentication is needed. The simplest setup is below; review the script at the URL before executing it:

```bash
cd /path/to/empty-folder
curl -fsSL https://raw.githubusercontent.com/alsh/personal-pi-assistant-template/main/scripts/setup.sh | bash
```

For a review-first run, download the same URL to a temporary file, inspect it, and execute it without a target argument while remaining in the target directory.

The script requires Git and network access to GitHub. It does not install npm/system packages, read credentials, or connect accounts.

## Local usage

```bash
cd /path/to/empty-folder
./scripts/doctor.sh
npm test
```

Restart Pi, review project trust, and run it with an explicitly selected private document root:

```bash
PA_DOCUMENT_ROOTS="$HOME/Documents/selected-folder" pi
```

Then use:

```text
/pa-status
/pa-index
/pa-import /path/to/document.pdf
/skill:document-search
/document-intake
/document-brief
/document-audit
/case-intake <case name>
/case-review <case-id>
/case-research <case-id or question>
```

`/pa-import` requires interactive confirmation. By default it preserves the original and stores extracted text in the private assistant data directory. `--text-only` and `--original-only` are available.

## Case and research workflow

Cases/tasks are private local records. They can link to indexed documents and track a user-provided checklist, but they do not submit anything externally or create calendar events.

Public research can be gathered with the host's approved web-research tools and saved privately as bounded evidence notes. Research notes should cite authoritative sources, access dates, confidence, jurisdiction, and unresolved questions. They are not legal, tax, medical, or financial advice.

Never place real personal documents, credentials, browser data, medical data, bank data, or Pi sessions in the repository.
