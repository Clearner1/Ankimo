#!/usr/bin/env bash
set -euo pipefail

script_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
live_dir="${ANKIMO_LIVE_DIR:-$script_repo}"
dev_dir="${ANKIMO_DEV_DIR:-$(dirname "$live_dir")/Ankimo-backup}"

if [[ ! -d "$dev_dir" || ! -d "$live_dir/.git" ]]; then
  echo "Ankimo development or production checkout is missing" >&2
  exit 1
fi
dev_dir="$(cd "$dev_dir" && pwd -P)"
live_dir="$(cd "$live_dir" && pwd -P)"

remote_sha="$(git -C "$dev_dir" ls-remote origin refs/heads/main | awk 'NR == 1 { print $1 }')"
live_sha="$(git -C "$live_dir" rev-parse HEAD)"
if [[ -z "$remote_sha" ]]; then
  echo "Could not resolve origin/main" >&2
  exit 1
fi
if [[ "$remote_sha" == "$live_sha" ]]; then exit 0; fi

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] main changed: $live_sha -> $remote_sha"
ANKIMO_DEV_DIR="$dev_dir" ANKIMO_LIVE_DIR="$live_dir" bash "$live_dir/scripts/deploy-local.sh"
