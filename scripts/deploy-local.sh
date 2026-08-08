#!/usr/bin/env bash
set -euo pipefail

dev_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
live_dir="${ANKIMO_LIVE_DIR:-$(dirname "$dev_dir")/Ankimo}"

if [[ ! -d "$live_dir/.git" || ! -f "$live_dir/package.json" ]]; then
  echo "Production checkout not found: $live_dir" >&2
  exit 1
fi
live_dir="$(cd "$live_dir" && pwd -P)"
if [[ "$live_dir" == "$dev_dir" || "$live_dir" == "/" ]]; then
  echo "Refusing unsafe production path: $live_dir" >&2
  exit 1
fi
if [[ "$(git -C "$live_dir" branch --show-current)" != "main" ]]; then
  echo "Production checkout must stay on main" >&2
  exit 1
fi
if ! git -C "$live_dir" diff --quiet || ! git -C "$live_dir" diff --cached --quiet; then
  echo "Production checkout has tracked changes; deployment stopped" >&2
  exit 1
fi
if [[ "$(git -C "$dev_dir" remote get-url origin)" != "$(git -C "$live_dir" remote get-url origin)" ]]; then
  echo "Development and production origins do not match" >&2
  exit 1
fi

git -C "$dev_dir" fetch origin main
git -C "$live_dir" fetch origin main
target_sha="$(git -C "$dev_dir" rev-parse origin/main)"
if ! git -C "$live_dir" merge-base --is-ancestor HEAD "$target_sha"; then
  echo "Production main cannot fast-forward to $target_sha" >&2
  exit 1
fi

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/ankimo-deploy.XXXXXX")"
trap 'rm -rf "$stage_dir"' EXIT
mkdir "$stage_dir/source"
git -C "$dev_dir" archive "$target_sha" | tar -x -C "$stage_dir/source"

(
  cd "$stage_dir/source"
  npm ci
  npm run check
)
test -s "$stage_dir/source/dist/index.html"

git -C "$live_dir" merge --ff-only "$target_sha"
deploy_dir="$live_dir/.deploy"
next_dir="$deploy_dir/next-$target_sha"
previous_dir="$deploy_dir/previous"
mkdir -p "$deploy_dir"
if [[ -e "$next_dir" ]]; then mv "$next_dir" "$stage_dir/stale-next"; fi
if [[ -e "$previous_dir" ]]; then mv "$previous_dir" "$stage_dir/older-previous"; fi
mv "$stage_dir/source/dist" "$next_dir"

had_current=false
if [[ -e "$live_dir/dist" ]]; then
  mv "$live_dir/dist" "$previous_dir"
  had_current=true
fi
if ! mv "$next_dir" "$live_dir/dist"; then
  if $had_current; then mv "$previous_dir" "$live_dir/dist"; fi
  exit 1
fi

local_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H 'Host: ankimo.yzr-stack.top' http://127.0.0.1:8080/ || true)"
if [[ "$local_status" != "200" && "$local_status" != "401" ]]; then
  mv "$live_dir/dist" "$stage_dir/failed-dist"
  if $had_current; then mv "$previous_dir" "$live_dir/dist"; fi
  echo "Local smoke test failed ($local_status); static files rolled back" >&2
  exit 1
fi

public_status="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://ankimo.yzr-stack.top/ || true)"
echo "Deployed $target_sha (local HTTP $local_status, public HTTP ${public_status:-unreachable})"
