#!/usr/bin/env bash
# Shared setup for the test scripts in this folder: a temporary work directory that is
# removed on exit, the environment that points the backup at a fake tree, and small helpers.
# Source this file; do not run it.

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
writer_pid=""
passed=0

cleanup() {
  if [ -n "$writer_pid" ]; then kill "$writer_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

check() {
  local description=$1
  shift
  if "$@"; then
    passed=$((passed + 1))
    echo "ok   $description"
  else
    echo "FAIL $description" >&2
    exit 1
  fi
}

count_files() { { find "$1" -maxdepth 1 -type f -name "$2" 2>/dev/null || true; } | wc -l; }

# Names of this user's processes that nothing may inspect (for example "(sd-pam)" on a login
# machine). The backup skips them only when a test passes them in GAFFER_UNINSPECTABLE_OK_COMMS,
# so a test writer that hides itself is the one process that still counts.
uninspectable_comms() {
  local proc comms=""
  for proc in /proc/[0-9]*; do
    [ "$(stat -c %u "$proc" 2>/dev/null)" = "$(id -u)" ] || continue
    ls "$proc/fd" >/dev/null 2>&1 && continue
    [ -d "$proc" ] || continue
    comms+="$(cat "$proc/comm" 2>/dev/null)|"
  done
  echo "${comms%|}"
}

export GAFFER_SAVE_DIR="$work/SaveGames"
export GAFFER_BACKUP_DIR="$work/backups"
export GAFFER_QUIET_SECONDS=0
export GAFFER_MIN_FREE_MB=1
GAFFER_UNINSPECTABLE_OK_COMMS=$(uninspectable_comms)
export GAFFER_UNINSPECTABLE_OK_COMMS
