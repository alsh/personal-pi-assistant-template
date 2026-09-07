#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi is not installed; package manifest/resource checks still ran."
  exit 0
fi

sandbox="$(mktemp -d "${TMPDIR:-/tmp}/personal-assistant-pi-smoke.XXXXXX")"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/documents"
printf '# Synthetic Pi smoke fixture\n' >"$sandbox/documents/smoke.md"

# Keep Pi's settings/session lookup and the assistant data outside both the
# package repository and the user's main data directory. --offline prevents
# startup network operations; --list-models needs no provider request.
export PI_CODING_AGENT_DIR="$sandbox/pi-config"
export PA_DATA_DIR="$sandbox/data"
export PA_DOCUMENT_ROOTS="$sandbox/documents"
export PI_OFFLINE=1

mkdir -p "$sandbox/consumer"
(
  cd "$sandbox/consumer"
  timeout 30 pi install "$root" -l
)
test -f "$sandbox/consumer/.pi/settings.json"
test ! -e "$root/.pi"
# The consumer is a disposable synthetic sandbox, so trust is explicit here
# only to exercise package loading through its generated project settings.
installed_output="$(
  cd "$sandbox/consumer"
  timeout 30 pi --offline --no-session --approve --list-models openai/gpt-4 2>&1
)"
printf '%s\n' "$installed_output" | grep -q '^provider[[:space:]]\+model' || {
  echo 'FAIL: Pi could not load the installed package from a separate consumer' >&2
  exit 1
}

pushd "$sandbox" >/dev/null
output="$(timeout 30 pi --offline --no-session -e "$root" --list-models openai/gpt-4 2>&1)"
popd >/dev/null
printf '%s\n' "$output" | sed -n '1,5p'
printf '%s\n' "$output" | grep -q '^provider[[:space:]]\+model' || {
  echo 'FAIL: Pi did not produce model-list output while loading the package' >&2
  exit 1
}

if find "$root" -path "$root/.git" -prune -o -type d -name .pi -print -quit | grep -q .; then
  echo 'FAIL: package smoke test found a .pi directory in the source package' >&2
  exit 1
fi

echo 'Pi package smoke test passed in a temporary sandbox.'
