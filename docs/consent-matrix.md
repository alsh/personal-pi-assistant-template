# Connector consent matrix — template baseline

No remote connector is enabled.

| Capability | Scope | Writes | Status |
|---|---|---|---|
| Local document roots | Explicit paths from config/environment | Confirmed local rename/move/tag only | Active |
| Local document import | User-selected source file | Private local copy/text extraction after confirmation | Active |
| Local note workspace | Private Markdown/Org/text files under the data directory | Create/rewrite/append after confirmation | Active; files are canonical |
| Document search index | Derived SQLite cache from source files | Rebuildable local cache only | Active |
| Public research | Public queries without personal identifiers | Append cited text to notes after confirmation | Host-dependent; no automatic web connector |
| Google Calendar | Explicit future read-only calendar scope | None | Disabled |
| Google Drive | Explicit future private file/folder scope | None initially | Disabled |
| pCloud | Explicit future private encrypted backup folder | Upload only after restore test/confirmation | Disabled |
| Health/finance/banking | None | None | Parked |

Public-sharing methods, unauthenticated endpoints, open binds, browser-cookie access, and remote destructive operations are prohibited.
