#!/usr/bin/env bash
# Tests backup-saves.sh and restore-saves.sh against a fake SaveGames tree in a temporary
# directory. It never touches the real save directory or any remote host.
# Usage:  test-save-backup.sh [test_function ...]   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-common.sh"

# Fake saves are random bytes, so the real validator is replaced by one that accepts them.
# test-save-validation.sh tests the real validator.
printf '#!/bin/sh\nexit 0\n' >"$work/accept-all"
chmod +x "$work/accept-all"
export GAFFER_VALIDATOR="$work/accept-all"

modes() { (cd "$1" && find . -printf '%m %p\n' | sort); }

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

# The reviewer's probe: a writer writes half a save, keeps the file open and pauses for
# longer than the quiet threshold. Quiet time alone would call that save complete.
test_paused_partial_writer() {
  local archive
  ( exec 7>"$GAFFER_SAVE_DIR/server/Codex_autosave_2.sav"
    printf 'first-half|' >&7
    sleep 6
    printf 'second-half' >&7
    exec 7>&- ) &
  writer_pid=$!
  sleep 0.5
  GAFFER_QUIET_SECONDS=2 GAFFER_MAX_WAIT_SECONDS=30 "$here/backup-saves.sh" pre-install paused-writer >/dev/null 2>&1 || true
  wait "$writer_pid"
  archive=$(find "$work/backups/pre-install" -name 'saves-*-paused-writer.tar')
  check "no incomplete save is archived while a writer holds the file open" \
    bash -c '[ -z "$0" ] || { "$1" "$0" "$2" >/dev/null && diff -r "$3" "$2/SaveGames"; }' \
    "$archive" "$here/restore-saves.sh" "$work/restored-paused" "$GAFFER_SAVE_DIR"
  check "the paused-writer run finished with the complete file" test "$(cat "$GAFFER_SAVE_DIR/server/Codex_autosave_2.sav")" = 'first-half|second-half'
}

# A process that only reads a save (for example foreman-save-sync) must not block a backup.
test_reader_does_not_block() {
  local before
  before=$(count_files "$work/backups/pre-install" 'saves-*.tar')
  ( exec 7<"$GAFFER_SAVE_DIR/server/Codex_autosave_0.sav"; sleep 8 ) &
  writer_pid=$!
  sleep 0.3
  check "a reader does not block the backup" \
    env GAFFER_MAX_WAIT_SECONDS=3 "$here/backup-saves.sh" pre-install reader-open
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true
  check "the backup with a reader made one archive" test "$(count_files "$work/backups/pre-install" 'saves-*.tar')" -eq $((before + 1))
}

# A writer that holds a save open for write and never closes it: the backup must fail.
test_open_writer_never_closes() {
  local before
  before=$(count_files "$work/backups/pre-install" 'saves-*.tar')
  ( exec 7>>"$GAFFER_SAVE_DIR/server/Codex_autosave_1.sav"; sleep 8 ) &
  writer_pid=$!
  sleep 0.3
  check "backup fails while a save stays open for write" \
    bash -c '! GAFFER_QUIET_SECONDS=0 GAFFER_MAX_WAIT_SECONDS=2 "$0" pre-install open-forever >/dev/null 2>&1' "$here/backup-saves.sh"
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true
  check "no archive was made while a save stayed open" test "$(count_files "$work/backups/pre-install" 'saves-*.tar')" -eq "$before"
}

# Any failing step must leave nothing in the published directories.
test_failure_publishes_nothing() {
  local mode
  mkdir "$work/fake-bin"
  printf '#!/bin/sh\nexit 42\n' >"$work/fake-bin/sha256sum"
  chmod +x "$work/fake-bin/sha256sum"
  for mode in daily "pre-install checksum-fails"; do
    # shellcheck disable=SC2086
    check "backup fails when sha256sum fails ($mode)" \
      bash -c '! PATH="$0:$PATH" GAFFER_BACKUP_DIR="$1" "$2" $3 >/dev/null 2>&1' "$work/fake-bin" "$work/failed-backups" "$here/backup-saves.sh" "$mode"
    check "a failed run leaves nothing published ($mode)" test -z "$(find "$work/failed-backups/daily" "$work/failed-backups/pre-install" -type f)"
  done
  check "a failed run leaves no staging directory" test -z "$(find "$work/failed-backups" -maxdepth 1 -name '.staging.*')"
}

# A writer that hides itself (marks itself non-dumpable) must count as busy, not as absent.
# It writes first-half, hides after the backup has started to wait, and writes the rest later.
# The scan must treat "cannot inspect" as busy on every scan, not only on the first.
hide_and_write() {
  mkdir -p "$work/bin"
  ln -sf "$(command -v python3)" "$work/bin/hidden-writer"
  "$work/bin/hidden-writer" -c '
import ctypes, sys, time
target = sys.argv[1]
handle = open(target, "w")
handle.write("first-half|"); handle.flush()
time.sleep(3)
ctypes.CDLL(None).prctl(4, 0)  # PR_SET_DUMPABLE = 0: /proc/<pid>/fd is now unreadable
time.sleep(4)
handle.write("second-half"); handle.close()
' "$GAFFER_SAVE_DIR/server/Codex_autosave_2.sav" &
  writer_pid=$!
  sleep 0.5
}

test_writer_hides_after_first_scan() {
  local before
  before=$(count_files "$work/backups/pre-install" 'saves-*.tar')
  hide_and_write
  check "backup makes no archive while a writer hides after the first scan" \
    bash -c '! GAFFER_QUIET_SECONDS=2 GAFFER_MAX_WAIT_SECONDS=3 "$0" pre-install hides-late >/dev/null 2>&1' "$here/backup-saves.sh"
  wait "$writer_pid"
  check "the hiding writer left no archive behind" test "$(count_files "$work/backups/pre-install" 'saves-*.tar')" -eq "$before"
}

test_writer_hides_then_finishes() {
  local archive
  hide_and_write
  GAFFER_QUIET_SECONDS=2 GAFFER_MAX_WAIT_SECONDS=30 "$here/backup-saves.sh" pre-install hides-then-done >/dev/null 2>&1 || true
  wait "$writer_pid"
  archive=$(find "$work/backups/pre-install" -name 'saves-*-hides-then-done.tar')
  check "an archive of a writer that hid waits for the complete file" \
    bash -c '[ -n "$0" ] && "$1" "$0" "$2" >/dev/null && diff -r "$3" "$2/SaveGames"' \
    "$archive" "$here/restore-saves.sh" "$work/restored-hid" "$GAFFER_SAVE_DIR"
}

# An owner process that no one may inspect and that is not on the allow list blocks the backup.
test_blind_scan_fails_closed() {
  local before
  before=$(count_files "$work/backups/pre-install" 'saves-*.tar')
  mkdir -p "$work/bin"
  ln -sf "$(command -v python3)" "$work/bin/blind-process"
  "$work/bin/blind-process" -c 'import ctypes, time; ctypes.CDLL(None).prctl(4, 0); time.sleep(6)' &
  writer_pid=$!
  sleep 0.5
  check "backup makes no archive while an owner process cannot be inspected" \
    bash -c '! GAFFER_MAX_WAIT_SECONDS=2 "$0" pre-install blind >/dev/null 2>&1' "$here/backup-saves.sh"
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true
  check "the blind-scan run made no archive" test "$(count_files "$work/backups/pre-install" 'saves-*.tar')" -eq "$before"
}

test_bad_arguments() {
  check "pre-install without a label is refused" bash -c '! "$0" pre-install >/dev/null 2>&1' "$here/backup-saves.sh"
  check "a label with a path separator is refused" bash -c '! "$0" pre-install ../x >/dev/null 2>&1' "$here/backup-saves.sh"
}

run_all() {
  test_daily_and_rotation
  test_restore_to_copy
  test_damaged_archive
  test_busy_saves
  test_never_quiet
  test_paused_partial_writer
  test_reader_does_not_block
  test_open_writer_never_closes
  test_failure_publishes_nothing
  test_blind_scan_fails_closed
  test_writer_hides_after_first_scan
  test_writer_hides_then_finishes
  test_bad_arguments
}

# With arguments, run only the named tests (each needs no earlier test).
make_fake_saves
if [ "$#" -gt 0 ]; then "$@"; else run_all; fi
echo "all $passed checks passed"
