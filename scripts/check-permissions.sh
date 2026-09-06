#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
data_dir="${PA_DATA_DIR:-$HOME/.local/share/personal-assistant}"

check_dir() {
  local path="$1"
  [[ -d "$path" ]] || return 0
  local mode
  mode=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")
  if [[ "$mode" != "700" ]]; then
    echo "FAIL: directory is not owner-only: $path mode=$mode" >&2
    return 1
  fi
  echo "OK: private directory $path"
}

check_file() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  local mode
  mode=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path")
  if [[ "$mode" != "600" ]]; then
    echo "FAIL: file is not owner-only: $path mode=$mode" >&2
    return 1
  fi
  echo "OK: private file $path"
}

check_dir "$data_dir/notes"
check_dir "$data_dir/documents"
check_dir "$data_dir/extracted"
check_file "$data_dir/audit.ndjson"
check_dir "$data_dir"
check_file "$data_dir/documents.sqlite"
check_file "$data_dir/documents.sqlite-wal"
check_file "$data_dir/documents.sqlite-shm"
check_dir "$root/.pi/sessions"

cat <<'EOF'
No credentials, document bodies, browser data, or environment values were read.
A missing data directory is allowed before the first indexing run.
EOF
