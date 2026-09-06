#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly required=(node jq sqlite3 rg)
readonly optional=(pdftotext unzip gpg git)

printf 'project=%s\n' "$root"
printf 'project mode: '
stat -c '%a %n' "$root" 2>/dev/null || stat -f '%Lp %N' "$root"

printf '\nrequired commands\n'
for cmd in "${required[@]}"; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '  OK   %s\n' "$cmd"
  else
    printf '  MISS %s\n' "$cmd"
  fi
done

printf '\noptional local extract/backup commands\n'
for cmd in "${optional[@]}"; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '  OK   %s\n' "$cmd"
  else
    printf '  --   %s\n' "$cmd"
  fi
done

printf '\nproject files\n'
for path in \
  AGENTS.md \
  .pi/settings.json \
  .pi/APPEND_SYSTEM.md \
  .pi/personal-assistant.json \
  .pi/extensions/personal-assistant.ts \
  .pi/extensions/personal-assistant-core.mjs \
  docs/policy.md \
  docs/consent-matrix.md \
  scripts/test-stage1.mjs; do
  if [[ -e "$root/$path" ]]; then printf '  OK   %s\n' "$path"; else printf '  MISS %s\n' "$path"; fi
done

printf '\nfixture files\n'
find "$root/fixtures/documents" -type f -print 2>/dev/null | sed "s#^$root/##" | sort || true

if [[ -n "${PA_DATA_DIR:-}" ]]; then
  echo
  echo "PA_DATA_DIR is set; value intentionally not printed."
fi

cat <<'EOF'

This doctor intentionally does not read credentials, browser profiles, private
files, environment variable values, or connector endpoints. It does not log in,
contact a service, or index documents. Run scripts/test-stage1.mjs for the
offline synthetic test suite.
EOF
