# Consent matrix — public template baseline

No remote connector is enabled.

| Capability | Scope | Writes | Status |
|---|---|---|---|
| Local document roots | Explicit paths from config/environment | Rename, move, and tag only through proposal plus immediate confirmation | Active |
| Local document import | User-selected source file | Private local copy and/or text extraction after immediate confirmation | Active |
| Assistant-owned text memory | Private Markdown/Org/plain-text artifacts under `PA_DATA_DIR/notes/` | Create, rewrite, and append directly; report changed paths; no per-write confirmation | Active |
| Legacy migration | Explicitly selected old local data | Human-readable text artifacts after a separate confirmation | Optional transition helper |
| Document search index | Derived SQLite cache from source files | Rebuildable local cache only | Active |
| Public research | Privacy-safe public queries without personal identifiers | Cited text may be stored as assistant-owned memory; external actions remain separately gated | No automatic web connector |
| Future read-only connector | Explicitly reviewed private scope | None initially | Disabled |
| Destructive or external action | Explicit target and action-specific scope | Separate immediate confirmation required | Not autonomous |

Public-sharing methods, unauthenticated endpoints, open binds, browser-cookie
access, password/OTP automation, and remote destructive operations are
prohibited.

## Package loading boundary

The package source contains only top-level resources (`extensions/`, `skills/`,
`prompts/`, and `personal-assistant.json`) plus generic documentation,
synthetic fixtures, scripts, and schemas. It has no `.pi` project state or
installed extension. Direct tests use `pi -e /path/to/package` from a separate
sandbox; persistent `pi install` commands run from a separate consumer, whose
`.pi` settings stay outside the source package.
