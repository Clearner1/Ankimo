#!/usr/bin/env bash
set -euo pipefail
umask 077

script_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
live_dir="$(dirname "$script_repo")/Ankimo"
if [[ ! -d "$live_dir" ]]; then
  echo "Live checkout not found: $live_dir" >&2
  exit 1
fi
live_dir="$(cd "$live_dir" && pwd -P)"
api_script="$live_dir/server/ankimo-api.mts"
if [[ ! -f "$api_script" ]]; then
  echo "API entrypoint not found: $api_script" >&2
  exit 1
fi

node_path="$(command -v node || true)"
if [[ -z "$node_path" || "$node_path" != /* ]]; then
  echo "Could not resolve an absolute node executable" >&2
  exit 1
fi

label="top.yzr.ankimo.api"
user_id="$(id -u)"
launch_domain="gui/$user_id"
service_target="$launch_domain/$label"
launch_agents_dir="$HOME/Library/LaunchAgents"
log_dir="$HOME/Library/Logs/Ankimo"
plist_path="$launch_agents_dir/$label.plist"

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

escaped_node_path="$(xml_escape "$node_path")"
escaped_api_script="$(xml_escape "$api_script")"
escaped_live_dir="$(xml_escape "$live_dir")"
escaped_stdout="$(xml_escape "$log_dir/api.out.log")"
escaped_stderr="$(xml_escape "$log_dir/api.err.log")"

mkdir -p "$launch_agents_dir" "$log_dir"
tmp_plist="$(mktemp "${TMPDIR:-/tmp}/$label.XXXXXX")"
cleanup() {
  if [[ -n "${tmp_plist:-}" && -e "$tmp_plist" ]]; then rm -f "$tmp_plist"; fi
}
trap cleanup EXIT

cat > "$tmp_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_node_path</string>
    <string>$escaped_api_script</string>
    <string>--serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$escaped_live_dir</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$escaped_stdout</string>
  <key>StandardErrorPath</key>
  <string>$escaped_stderr</string>
</dict>
</plist>
PLIST

plutil -lint "$tmp_plist" >/dev/null
chmod 600 "$tmp_plist"
launchctl bootout "$service_target" 2>/dev/null || true
mv -f "$tmp_plist" "$plist_path"
tmp_plist=""
launchctl bootstrap "$launch_domain" "$plist_path"
launchctl kickstart -k "$service_target"
launchctl print "$service_target"
