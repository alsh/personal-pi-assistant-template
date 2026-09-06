# Contributing

This repository is a public template. Do not add real personal documents, credentials, browser data, bank data, medical data, or private session files.

## Before submitting changes

```bash
npm test
npm run check:policy
npm run check:permissions
```

Changes must preserve these boundaries:

- canonical personal content remains in private text files, not a required database;
- helper indexes are rebuildable from source files;
- local writes require confirmation and redacted audit output;
- connectors start read-only with exact scopes;
- no public-sharing or unauthenticated endpoint is added;
- synthetic fixtures are used for tests.
