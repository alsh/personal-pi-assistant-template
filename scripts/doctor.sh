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

printf '\npackage files\n'
for path in \
  package.json \
  personal-assistant.json \
  extensions/personal-assistant.ts \
  extensions/personal-assistant-core.mjs \
  skills/note-workspace/SKILL.md \
  prompts/note-intake.md \
  AGENTS.md \
  docs/policy.md \
  docs/consent-matrix.md \
  scripts/test-stage1.mjs; do
  if [[ -e "$root/$path" ]]; then printf '  OK   %s\n' "$path"; else printf '  MISS %s\n' "$path"; fi
done

if find "$root" -path "$root/.git" -prune -o -type d -name .pi -print -quit | grep -q .; then
  echo '  FAIL .pi directory found in the package repository' >&2
else
  echo '  OK   no .pi directory in the package repository'
fi

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
offline synthetic test suite. Any `pi install -l` command belongs in a separate
consumer workspace, not this package repository.
EOF
