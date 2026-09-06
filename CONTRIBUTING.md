# Contributing

This repository is a public template. Do not add real personal documents, credentials, browser data, bank data, medical data, or private session files.

## Before submitting changes

```bash
npm test
npm run check:policy
npm run check:permissions
```

Changes that add a connector must include:

- a manifest with exact scopes and data classification;
- a read-only fixture adapter and tests;
- provenance/freshness behavior;
- explicit revoke/retention behavior;
- public-sharing/open-bind tests;
- confirmation and audit behavior for writes;
- documentation in `docs/consent-matrix.md`.

Do not add banking or medical browser-password/cookie automation. Do not add public-sharing functionality.
