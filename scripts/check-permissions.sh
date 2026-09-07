#!/usr/bin/env bash
set -euo pipefail


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

if [[ -n "${PA_DATA_DIR:-}" ]]; then
  data_dir="$PA_DATA_DIR"
  check_dir "$data_dir/notes"
  check_dir "$data_dir/documents"
  check_dir "$data_dir/extracted"
  check_file "$data_dir/audit.ndjson"
  check_dir "$data_dir"
  check_file "$data_dir/documents.sqlite"
  check_file "$data_dir/documents.sqlite-wal"
  check_file "$data_dir/documents.sqlite-shm"
else
  echo 'SKIP: set PA_DATA_DIR to a temporary/synthetic data directory to check runtime permissions.'
fi

cat <<'EOF'
No credentials, document bodies, browser data, or environment values were read.
A missing data directory is allowed before the first indexing run. This check
never defaults to the main personal-assistant data directory; pass an explicit
PA_DATA_DIR when checking a sandbox.
EOF
