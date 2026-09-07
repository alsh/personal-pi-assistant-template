#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
fail=0

if ! jq -e '(.keywords | index("pi-package")) != null' "$root/package.json" >/dev/null || \
   ! jq -e '.pi.extensions == ["./extensions"] and .pi.skills == ["./skills"] and .pi.prompts == ["./prompts"]' "$root/package.json" >/dev/null; then
  echo 'FAIL: package.json is missing the Pi package manifest' >&2
  fail=1
fi

if find "$root" -path "$root/.git" -prune -o -type d -name .pi -print -quit | grep -q .; then
  echo 'FAIL: package repository contains a .pi directory; package resources must be top-level' >&2
  fail=1
fi

if rg -n -E 'fetch\(|https?://|0\.0\.0\.0|publicShare|public_link|shareLink' \
  "$root/extensions/personal-assistant.ts" \
  "$root/extensions/personal-assistant-core.mjs" >/tmp/personal-assistant-policy-scan.$$ 2>/dev/null; then
  echo 'FAIL: Stage 1 implementation contains a network/public-sharing pattern:' >&2
  cat /tmp/personal-assistant-policy-scan.$$ >&2
  fail=1
fi
rm -f /tmp/personal-assistant-policy-scan.$$

if jq -e 'has("documentRoots") and (.documentRoots | type == "array") and (any(.documentRoots[]; contains("fixtures/documents")))' "$root/personal-assistant.json" >/dev/null; then
  echo 'OK: package document roots default to synthetic fixtures'
else
  echo 'FAIL: package document roots are not explicitly configured to synthetic fixtures' >&2
  fail=1
fi

for schema in "$root"/schemas/*.json; do
  jq empty "$schema" >/dev/null || { echo "FAIL: invalid JSON schema: $schema" >&2; fail=1; }
done

if (( fail )); then exit 1; fi
echo 'Stage 1 policy checks passed.'
