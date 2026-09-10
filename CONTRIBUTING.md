# Contributing

This repository is a public template. Do not add real personal documents,
credentials, browser data, bank data, medical data, or private session files.
Use synthetic fixtures and a disposable data directory for every test.

## Before submitting changes

```bash
npm test
npm run test:package
npm run check
PA_DATA_DIR="$(mktemp -d)" npm run check:permissions
bash -n scripts/*.sh
git diff --check
```

This repository is distributable Pi package source. Keep `extensions/`,
`skills/`, `prompts/`, and `personal-assistant.json` at the package top level.
Do not add a `.pi` directory or install the package into itself. Test a direct
load with `pi -e /path/to/package` from a separate sandbox; run `pi install`
only from a separate consumer/workspace, where any `.pi/settings.json` belongs.

Changes must preserve these boundaries:

- canonical personal content remains in portable text files, not a required database;
- helper indexes are rebuildable from source files;
- assistant-owned memory create/rewrite/append writes are direct and report changed paths;
- source-document imports, source-document mutations, legacy migration, deletion, and external/high-impact actions retain separate confirmation gates;
- connectors start read-only with exact scopes;
- no public-sharing or unauthenticated endpoint is added;
- no board/case/task schema, opaque identifier, or database-only artifact meaning is introduced;
- synthetic fixtures are used for tests.
