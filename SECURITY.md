# Security policy

This is a public template. Never put secrets or real personal data into issues, pull requests, commits, CI logs, or public links.

## Do not report these publicly

- API keys, OAuth refresh tokens, cookies, private keys, passwords, or OTPs;
- bank account or transaction data;
- medical records or identifiers;
- private note or document bodies;
- Pi session files or connector databases.

For a suspected vulnerability, use a private GitHub security channel rather than publishing real personal data. Include the affected commit/version, reproduction using synthetic data, impact, and a proposed mitigation.

The template intentionally has no remote connector and no public-sharing feature. Keep canonical notes and other personal data outside the repository. Review the arbitrary-code extension before loading it; Pi extensions run with the process user's permissions.

This repository is package source, not a Pi consumer project. It must contain only
top-level package resources and source documentation, with no `.pi` directory or
installed extension. Exercise package loading with synthetic `PA_DATA_DIR` and
`PA_DOCUMENT_ROOTS` values from a separate sandbox; any consumer `.pi` settings
must remain in that separate consumer.
