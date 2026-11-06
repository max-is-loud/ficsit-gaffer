#!/usr/bin/env bash
# Copies the ff-server values of the bridge (dev.env) from the server to a private file on
# this machine, without showing, logging or committing them. The values travel inside the
# SSH session only. They go into a mode 0600 file that is created before it is filled; nothing
# prints them. The script refuses to write inside a git repository, and it refuses to
# overwrite an existing file. It checks the file by its shape (four named values) and reports
# only the names.
# Runs on the dev machine. See tools/testbed/bridge-runbook.md.
#
# Usage:  fetch-bridge-env.sh [ssh-host] [destination-file]
set -euo pipefail
umask 077

SSH=${GAFFER_SSH:-ssh}
HOST=${1:-openclaw}
DESTINATION=${2:-${XDG_CONFIG_HOME:-$HOME/.config}/gaffer/bridge.env}
REMOTE_FILE=${GAFFER_REMOTE_DEV_ENV:-/etc/gaffer-bridge/dev.env}
REQUIRED_NAMES="FOREMAN_BRIDGE_URL FOREMAN_BRIDGE_QUERY_TOKEN FOREMAN_BRIDGE_SERVER_ID FOREMAN_BRIDGE_WORLD_ID"

temp=""

fail() {
  echo "fetch-bridge-env: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$temp" ]; then rm -f "$temp"; fi
}
trap cleanup EXIT

main() {
  local directory name
  directory=$(dirname "$DESTINATION")
  [ ! -e "$DESTINATION" ] || fail "$DESTINATION already exists; refusing to overwrite it"
  mkdir -p "$directory"
  chmod 700 "$directory"
  if git -C "$directory" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "$directory is inside a git repository; choose a path outside it"
  fi
  temp=$(mktemp "$directory/.bridge.env.XXXXXX")
  "$SSH" "$HOST" "sudo -n cat $REMOTE_FILE" >"$temp" || fail "could not read $REMOTE_FILE on $HOST"
  for name in $REQUIRED_NAMES; do
    [ "$(grep -c "^$name=." "$temp")" -eq 1 ] || fail "the file from $HOST has no single value for $name"
  done
  [ "$(grep -c . "$temp")" -eq "$(echo "$REQUIRED_NAMES" | wc -w)" ] || fail "the file from $HOST holds unexpected lines"
  chmod 600 "$temp"
  mv -n -- "$temp" "$DESTINATION"
  temp=""
  echo "fetch-bridge-env: wrote $DESTINATION (mode 0600) with: $REQUIRED_NAMES. Values not shown."
  echo "fetch-bridge-env: add FOREMAN_BRIDGE_PLAYTHROUGH_ID yourself once the playthrough exists."
}

main
