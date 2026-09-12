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
# Usage (after choosing an empty target directory):
#   cd /path/to/empty-folder
#   curl -fsSL https://raw.githubusercontent.com/alsh/personal-pi-assistant-template/main/scripts/setup.sh | bash
#
# Reviewable equivalent:
#   curl -fsSL https://raw.githubusercontent.com/alsh/personal-pi-assistant-template/main/scripts/setup.sh \
#     -o /tmp/personal-pi-setup.sh
#   sed -n '1,260p' /tmp/personal-pi-setup.sh   # review before execution
#   bash /tmp/personal-pi-setup.sh
#   rm -f /tmp/personal-pi-setup.sh
#
# Optional local invocation with an explicit target:
#   ./scripts/setup.sh /path/to/empty-folder
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
offline checks. TARGET_DIR defaults to the current directory (`.`). No GitHub
authentication, npm install, or account connection is required.
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
# Permission checks use a disposable sandbox rather than the main data root.
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/personal-assistant-setup.XXXXXX")"
trap 'rm -rf "$sandbox"' EXIT
./scripts/doctor.sh
npm test
npm run test:package
npm run check:policy
PA_DATA_DIR="$sandbox/data" npm run check:permissions

cat <<'EOF'

Setup completed.

Before using real documents:
  1. Review AGENTS.md, docs/policy.md, and docs/consent-matrix.md.
  2. Record this package path, then test it from a separate consumer/workspace:
       package_path="$PWD"
       PA_DATA_DIR="$(mktemp -d)" pi -e "$package_path" --no-session
  3. For a persistent install, leave this package directory and run from the
     separate consumer/workspace:
       pi install "$package_path"
     Use `pi install -l "$package_path"` only there; it writes that
     consumer's `.pi/settings.json`, not package resources.
  4. Place private source documents under `PA_DATA_DIR/documents`, or use
     /pa-import for a user-selected import after its confirmation prompt; the
     default package root remains synthetic fixtures.
  5. Run /pa-status, then /pa-index after the package is loaded.

No extension was installed into the cloned package, no credentials were read,
and no remote account was connected.
EOF
