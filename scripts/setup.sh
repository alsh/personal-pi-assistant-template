#!/usr/bin/env bash
# Clone the public Pi personal-assistant template into an empty folder and run
# its offline validation checks. This script does not require GitHub login.
#
# It intentionally does NOT:
#   - install npm/system packages;
#   - contact a cloud, bank, health provider, or local personal-data service;
#   - read credentials, browser profiles, or private documents;
#   - enable write-capable remote connectors.
#
# Usage:
#   ./scripts/setup.sh /path/to/empty-folder
#   curl -fsSL https://raw.githubusercontent.com/alsh/personal-pi-assistant-template/main/scripts/setup.sh \
#     -o /tmp/personal-pi-setup.sh
#   bash /tmp/personal-pi-setup.sh /path/to/empty-folder
#
# The downloaded script should be reviewed before execution.

set -euo pipefail

repo="${PA_PI_REPO:-alsh/personal-pi-assistant-template}"
ref="${PA_PI_REF:-main}"
repo_url="${PA_PI_REPO_URL:-https://github.com/${repo}.git}"
target="."

usage() {
  cat <<'EOF'
Usage: setup.sh [TARGET_DIR] [--repo OWNER/REPOSITORY] [--ref REF]

Clone the public personal-assistant template into an empty directory and run
offline checks. No GitHub authentication, npm install, or account connection is
required.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --repo)
      [[ $# -ge 2 ]] || { echo "--repo requires a value" >&2; exit 2; }
      repo="$2"
      repo_url="https://github.com/${repo}.git"
      shift 2
      ;;
    --ref)
      [[ $# -ge 2 ]] || { echo "--ref requires a value" >&2; exit 2; }
      ref="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -* )
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ "$target" != "." ]]; then
        echo "Only one target directory may be supplied" >&2
        exit 2
      fi
      target="$1"
      shift
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "Missing git. Install Git before running setup." >&2
  exit 1
fi

if [[ -e "$target" ]]; then
  mkdir -p "$target"
  if [[ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "Refusing non-empty target directory: $target" >&2
    exit 1
  fi
else
  mkdir -p "$(dirname "$target")"
fi

echo "Cloning public repository $repo at ref $ref into $target"
git clone --depth 1 --branch "$ref" "$repo_url" "$target"

cd "$target"

remote="$(git remote get-url origin)"
branch="$(git branch --show-current)"
printf 'remote=%s\nbranch=%s\n' "$remote" "$branch"

# These checks are local and offline. They do not index any user documents.
./scripts/doctor.sh
npm test
npm run check:policy
npm run check:permissions

cat <<'EOF'

Setup completed.

Before using real documents:
  1. Review .pi/settings.json, AGENTS.md, docs/policy.md, and docs/consent-matrix.md.
  2. Restart Pi in this directory and review the project-trust prompt.
  3. Run Pi with an explicit private document root, for example:
       PA_DOCUMENT_ROOTS="$HOME/Documents/selected-folder" pi
  4. Run /pa-status, then /pa-index.

No packages were installed, no credentials were read, and no remote account was connected.
EOF
