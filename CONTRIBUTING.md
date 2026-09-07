# Contributing

This repository is a public template. Do not add real personal documents, credentials, browser data, bank data, medical data, or private session files.

## Before submitting changes

```bash
npm test
npm run test:package
npm run check:policy
PA_DATA_DIR="$(mktemp -d)" npm run check:permissions
bash -n scripts/*.sh
git diff --check
```

This repository is a distributable Pi package. Keep `extensions/`, `skills/`,
`prompts/`, and `personal-assistant.json` at the package top level. Do not add a
`.pi` directory or install the package into itself. Test with
`pi -e /path/to/package` from a separate sandbox; run `pi install` only from a
separate consumer/workspace, where any `.pi/settings.json` belongs.

Changes must preserve these boundaries:

- canonical personal content remains in private text files, not a required database;
- helper indexes are rebuildable from source files;
- local writes require confirmation and redacted audit output;
- connectors start read-only with exact scopes;
- no public-sharing or unauthenticated endpoint is added;
- synthetic fixtures are used for tests.
