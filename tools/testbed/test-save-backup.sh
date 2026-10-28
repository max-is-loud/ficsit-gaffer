#!/usr/bin/env bash
# Tests backup-saves.sh and restore-saves.sh against a fake SaveGames tree in a temporary
# directory. It never touches the real save directory or any remote host.
# Usage:  test-save-backup.sh      (exit 0 = all checks passed)
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
writer_pid=""
cleanup() {
  if [ -n "$writer_pid" ]; then kill "$writer_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

export GAFFER_SAVE_DIR="$work/SaveGames"
export GAFFER_BACKUP_DIR="$work/backups"
export GAFFER_QUIET_SECONDS=0
export GAFFER_MIN_FREE_MB=1
passed=0

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

modes() { (cd "$1" && find . -printf '%m %p\n' | sort); }
count_files() { find "$1" -maxdepth 1 -type f -name "$2" | wc -l; }

make_fake_saves() {
  mkdir -p "$GAFFER_SAVE_DIR/server"
  head -c 5604 /dev/urandom >"$GAFFER_SAVE_DIR/ServerSettings.7777.sav"
  for name in Codex_autosave_0 Codex_autosave_1 Codex_autosave_2 Codex_autosave_1_continue; do
    head -c 300000 /dev/urandom >"$GAFFER_SAVE_DIR/server/$name.sav"
  done
  touch -d '10 minutes ago' "$GAFFER_SAVE_DIR"/*.sav "$GAFFER_SAVE_DIR"/server/*.sav
  # The modes of the real server: group read, no access for others.
  chmod 640 "$GAFFER_SAVE_DIR"/*.sav "$GAFFER_SAVE_DIR"/server/*.sav
  chmod 750 "$GAFFER_SAVE_DIR" "$GAFFER_SAVE_DIR/server"
}

test_daily_and_rotation() {
  "$here/backup-saves.sh" pre-install before-bridge-v1 >/dev/null
  GAFFER_KEEP_DAILY=3 "$here/backup-saves.sh" daily >/dev/null
  for _ in 1 2 3 4; do
    sleep 1.1 # archive names carry a one-second timestamp
    GAFFER_KEEP_DAILY=3 "$here/backup-saves.sh" daily >/dev/null
  done
  check "five daily runs leave exactly 3 archives" test "$(count_files "$work/backups/daily" 'saves-*.tar')" -eq 3
  check "each kept daily archive has a checksum file" test "$(count_files "$work/backups/daily" 'saves-*.tar.sha256')" -eq 3
  check "the pre-install archive survived rotation" test "$(count_files "$work/backups/pre-install" 'saves-*-before-bridge-v1.tar')" -eq 1
  check "no staging directory is left behind" test -z "$(find "$work/backups" -maxdepth 1 -name '.staging.*')"
}

test_restore_to_copy() {
  local archive
  archive=$(find "$work/backups/pre-install" -name 'saves-*.tar')
  "$here/restore-saves.sh" "$archive" "$work/restored" >/dev/null
  check "restored copy matches the source byte for byte" diff -r "$GAFFER_SAVE_DIR" "$work/restored/SaveGames"
  check "restored copy keeps the file and directory modes" \
    test "$(modes "$GAFFER_SAVE_DIR")" = "$(modes "$work/restored/SaveGames")"
  check "restore refuses a non-empty destination" bash -c '! "$0" "$1" "$2" 2>/dev/null' "$here/restore-saves.sh" "$archive" "$work/restored"
  check "restore refuses a destination inside the live directory" \
    bash -c '! "$0" "$1" "$2" 2>/dev/null' "$here/restore-saves.sh" "$archive" "$GAFFER_SAVE_DIR/server/copy"
  check "restore refuses the live directory's parent" \
    bash -c '! "$0" "$1" "$2" 2>/dev/null' "$here/restore-saves.sh" "$archive" "$work"
}

test_damaged_archive() {
  local archive copy
  archive=$(find "$work/backups/daily" -name 'saves-*.tar' | sort | tail -1)
  copy="$work/damaged/$(basename "$archive")"
  mkdir "$work/damaged"
  cp "$archive" "$archive.sha256" "$work/damaged/"
  printf 'x' | dd of="$copy" bs=1 seek=2000 conv=notrunc 2>/dev/null
  check "restore refuses a damaged archive" bash -c '! "$0" "$1" "$2" 2>/dev/null' "$here/restore-saves.sh" "$copy" "$work/never"
  check "a refused restore creates nothing" test ! -e "$work/never"
}

test_busy_saves() {
  # A writer rewrites one save for 3 s. The backup must wait and archive the final content.
  local archive
  ( for _ in 1 2 3 4 5 6; do head -c 300000 /dev/urandom >"$GAFFER_SAVE_DIR/server/Codex_autosave_0.sav"; sleep 0.5; done ) &
  writer_pid=$!
  sleep 0.2
  GAFFER_QUIET_SECONDS=2 GAFFER_MAX_WAIT_SECONDS=30 "$here/backup-saves.sh" pre-install busy-writer >/dev/null
  wait "$writer_pid"
  archive=$(find "$work/backups/pre-install" -name 'saves-*-busy-writer.tar')
  "$here/restore-saves.sh" "$archive" "$work/restored-busy" >/dev/null
  check "archive taken during a write holds the finished file" diff -r "$GAFFER_SAVE_DIR" "$work/restored-busy/SaveGames"
}

test_never_quiet() {
  # A writer that never stops: the backup must fail and leave no archive.
  local before
  before=$(count_files "$work/backups/pre-install" 'saves-*.tar')
  ( while true; do touch "$GAFFER_SAVE_DIR/server/Codex_autosave_1.sav"; sleep 0.2; done ) &
  writer_pid=$!
  check "backup fails when saves never go quiet" \
    bash -c '! GAFFER_QUIET_SECONDS=2 GAFFER_MAX_WAIT_SECONDS=3 "$0" pre-install never-quiet >/dev/null 2>&1' "$here/backup-saves.sh"
  kill "$writer_pid"
  wait "$writer_pid" 2>/dev/null || true
  check "no archive was made by the failed run" test "$(count_files "$work/backups/pre-install" 'saves-*.tar')" -eq "$before"
  check "no staging directory is left after the failed run" test -z "$(find "$work/backups" -maxdepth 1 -name '.staging.*')"
}

test_bad_arguments() {
  check "pre-install without a label is refused" bash -c '! "$0" pre-install >/dev/null 2>&1' "$here/backup-saves.sh"
  check "a label with a path separator is refused" bash -c '! "$0" pre-install ../x >/dev/null 2>&1' "$here/backup-saves.sh"
}

make_fake_saves
test_daily_and_rotation
test_restore_to_copy
test_damaged_archive
test_busy_saves
test_never_quiet
test_bad_arguments
echo "all $passed checks passed"
