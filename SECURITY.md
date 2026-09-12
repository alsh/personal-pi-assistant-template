# Security policy

This is a distributable Pi package for a privacy-conscious personal assistant.
Never put secrets or real personal data into GitHub issues, pull requests,
commits, CI logs, or public links. Review this package's arbitrary-code
extension before loading it; Pi extensions run with the process user's
permissions.

## Do not report these publicly

- API keys, OAuth refresh tokens, cookies, private keys, passwords, or OTPs;
- bank account or transaction data;
- medical records or identifiers;
- private document bodies;
- Pi session files or connector databases.

For a suspected vulnerability, stop using the affected connector, preserve only
redacted diagnostic information, and contact the repository owner through a
private GitHub channel. Include the affected commit/version, reproduction using
synthetic data, impact, and a proposed mitigation. Do not upload real personal
data as evidence.

The project currently has no remote connector and no public-sharing feature.
Keep that invariant in future changes. The package repository must contain only
top-level Pi resources and source documentation; do not commit a `.pi` project
settings directory or an installed copy of the extension. Run package smoke
tests with only `PA_DATA_DIR` set to a temporary synthetic data root; the
package fixture root and its private `PA_DATA_DIR/documents` root are resolved
automatically, and keep consumer settings in a separate sandbox.
