#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
fail=0

if ! jq -e '.defaultTools == ["read", "grep", "find", "ls"]' "$root/.pi/settings.json" >/dev/null; then
  echo 'FAIL: project defaultTools are not the Stage 1 read-only set' >&2
  fail=1
fi

if rg -n -E 'fetch\(|https?://|0\.0\.0\.0|publicShare|public_link|shareLink' \
  "$root/.pi/extensions/personal-assistant.ts" \
  "$root/.pi/extensions/personal-assistant-core.mjs" >/tmp/personal-assistant-policy-scan.$$ 2>/dev/null; then
  echo 'FAIL: Stage 1 implementation contains a network/public-sharing pattern:' >&2
  cat /tmp/personal-assistant-policy-scan.$$ >&2
  fail=1
fi
rm -f /tmp/personal-assistant-policy-scan.$$

if jq -e 'has("documentRoots") and (.documentRoots | type == "array") and (any(.documentRoots[]; contains("fixtures/documents")))' "$root/.pi/personal-assistant.json" >/dev/null; then
  echo 'OK: document roots are explicitly configured'
else
  echo 'FAIL: document roots are not explicitly configured' >&2
  fail=1
fi

for schema in "$root"/schemas/*.json; do
  jq empty "$schema" >/dev/null || { echo "FAIL: invalid JSON schema: $schema" >&2; fail=1; }
done

if (( fail )); then exit 1; fi
echo 'Stage 1 policy checks passed.'
