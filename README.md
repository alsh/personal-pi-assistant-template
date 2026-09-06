# Personal Pi Assistant Template

A privacy-conscious local personal assistant project for [Pi](https://pi.dev).

## Current capabilities

- local document indexing/search;
- PDF/text/XML/EDM/ZIP extraction;
- hashes, duplicate detection, basic metadata, and stale-source detection;
- confirmation-gated document rename/move/tag proposals;
- importing a user-selected local file into a private data store;
- private document cases, checklist tasks, due dates, statuses, linked documents, and closure;
- synthetic fixtures and offline validation.

The template has no active Google Drive, pCloud, calendar, health, finance, banking, or public-sharing connector.

## Anonymous setup

The repository is public so a user does not need GitHub authentication to bootstrap it. Review the script before execution:

```bash
curl -fsSL https://raw.githubusercontent.com/alsh/personal-pi-assistant-template/main/scripts/setup.sh \
  -o /tmp/personal-pi-setup.sh
sed -n '1,240p' /tmp/personal-pi-setup.sh
bash /tmp/personal-pi-setup.sh /path/to/empty-folder
rm -f /tmp/personal-pi-setup.sh
```

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
```

`/pa-import` requires interactive confirmation. By default it preserves the original and stores extracted text in the private assistant data directory. `--text-only` and `--original-only` are available.

## Case workflow

Cases/tasks are private local records. They can link to indexed documents and track a user-provided checklist, but they do not submit anything externally or create calendar events.

```text
/case-intake <case name>
/case-review <case-id>
```

Never place real personal documents, credentials, browser data, medical data, bank data, or Pi sessions in the repository.
