#!/usr/bin/env bash
# Tests the save validation step of backup-saves.sh. The first group needs only Node.js and
# the pinned parser (npm ci in tools/testbed). The second group needs one real save: set
# GAFFER_TEST_REAL_SAVE to its path, or the group is skipped with a message. The real save
# is read, never written, and never leaves the temporary work directory.
# Usage:  test-save-validation.sh [test_function ...]   (exit 0 = all checks passed)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/test-common.sh"

real_save=${GAFFER_TEST_REAL_SAVE:-}
backup="$here/backup-saves.sh"
# Fast retries, so a test does not wait for the production delay.
export GAFFER_VALIDATE_RETRY_SECONDS=1

make_fake_saves() {
  mkdir -p "$GAFFER_SAVE_DIR/server"
  printf 'this is not a Satisfactory save file' >"$GAFFER_SAVE_DIR/server/Codex_autosave_0.sav"
  printf 'server settings are not a game save' >"$GAFFER_SAVE_DIR/ServerSettings.7777.sav"
  touch -d '10 minutes ago' "$GAFFER_SAVE_DIR"/*.sav "$GAFFER_SAVE_DIR"/server/*.sav
}

fresh_backups() { rm -rf "$work/backups"; }
pre_install_count() { count_files "$work/backups/pre-install" 'saves-*.tar'; }
nothing_published() { test -z "$(find "$work/backups/daily" "$work/backups/pre-install" -type f 2>/dev/null)"; }

# ---- Group 1: the validation step, with a stand-in validator and with the real one ----

test_validator_rejects_garbage() {
  mkdir "$work/garbage"
  printf 'this is not a Satisfactory save file' >"$work/garbage/not-a-save.sav"
  check "the validator rejects a file that is not a save" bash -c '! node "$0" "$1" >/dev/null 2>&1' "$here/validate-saves.mjs" "$work/garbage"
  : >"$work/garbage/not-a-save.sav"
  check "the validator rejects an empty save" bash -c '! node "$0" "$1" >/dev/null 2>&1' "$here/validate-saves.mjs" "$work/garbage"
  rm "$work/garbage/not-a-save.sav"
  check "the validator fails when it has nothing to check" bash -c '! node "$0" "$1" >/dev/null 2>&1' "$here/validate-saves.mjs" "$work/garbage"
}

test_real_validator_blocks_garbage_backup() {
  fresh_backups
  check "backup with the real validator makes no archive from a damaged save" \
    bash -c '! env -u GAFFER_VALIDATOR GAFFER_MAX_WAIT_SECONDS=2 "$0" pre-install garbage >/dev/null 2>&1' "$backup"
  check "nothing was published after the damaged save" nothing_published
}

# The stand-in fails twice (a writer still at work), then accepts: the backup must wait.
test_backup_waits_for_validator() {
  fresh_backups
  rm -f "$work/calls"
  printf '#!/bin/sh\nn=$(cat "%s/calls" 2>/dev/null || echo 0)\necho $((n + 1)) >"%s/calls"\n[ "$n" -ge 2 ]\n' "$work" "$work" >"$work/flaky"
  chmod +x "$work/flaky"
  check "backup retries until the validator accepts the copy" \
    env GAFFER_VALIDATOR="$work/flaky" GAFFER_MAX_WAIT_SECONDS=30 "$backup" pre-install flaky
  check "the validator ran three times" test "$(cat "$work/calls")" -eq 3
  check "exactly one archive was made" test "$(pre_install_count)" -eq 1
}

test_backup_gives_up_on_validator() {
  fresh_backups
  printf '#!/bin/sh\nexit 1\n' >"$work/always-no"
  chmod +x "$work/always-no"
  check "backup fails when the validator never accepts the copy" \
    bash -c '! GAFFER_VALIDATOR="$0" GAFFER_MAX_WAIT_SECONDS=3 "$1" daily >/dev/null 2>&1' "$work/always-no" "$backup"
  check "nothing was published after the validator refused" nothing_published
  check "no staging directory is left" test -z "$(find "$work/backups" -maxdepth 1 -name '.staging.*')"
}

test_validator_cannot_run() {
  fresh_backups
  printf '#!/bin/sh\nexit 2\n' >"$work/broken"
  chmod +x "$work/broken"
  check "backup fails at once when the validator cannot run" \
    bash -c 'start=$SECONDS; ! GAFFER_VALIDATOR="$0" GAFFER_MAX_WAIT_SECONDS=60 "$1" daily >/dev/null 2>&1 && [ $((SECONDS - start)) -lt 10 ]' "$work/broken" "$backup"
  check "nothing was published when the validator could not run" nothing_published
}

# ---- Group 2: the same checks against one real save ----

# Builds a save directory that holds the real save as server/real.sav, plus the cut copies.
prepare_real() {
  real_dir="$work/real-saves"
  mkdir -p "$real_dir/server"
  cp "$real_save" "$real_dir/server/real.sav"
  touch -d '10 minutes ago' "$real_dir/server/real.sav"
  mkdir -p "$work/cuts"
  boundary_at=$(node "$here/cut-save.mjs" "$real_save" boundary "$work/cuts/boundary.sav")
  mid_at=$(node "$here/cut-save.mjs" "$real_save" mid "$work/cuts/mid.sav")
}

real_backup() { env -u GAFFER_VALIDATOR GAFFER_SAVE_DIR="$real_dir" "$@"; }

test_real_save_passes() {
  fresh_backups
  check "the validator accepts the complete real save" node "$here/validate-saves.mjs" "$real_dir" >/dev/null
  check "backup of the complete real save makes an archive" real_backup "$backup" pre-install real-complete
  local archive
  archive=$(find "$work/backups/pre-install" -name 'saves-*-real-complete.tar')
  "$here/restore-saves.sh" "$archive" "$work/restored-real" >/dev/null
  check "the restored real save equals the source byte for byte" cmp "$real_save" "$work/restored-real/SaveGames/server/real.sav"
}

test_real_save_cuts_fail() {
  local kind
  fresh_backups
  real_backup "$backup" pre-install keep-one >/dev/null
  for kind in mid boundary; do
    rm -rf "$work/cut-$kind" && mkdir "$work/cut-$kind"
    cp "$work/cuts/$kind.sav" "$work/cut-$kind/cut.sav"
    check "the validator rejects a real save cut at a ${kind} point" bash -c '! node "$0" "$1" >/dev/null 2>&1' "$here/validate-saves.mjs" "$work/cut-$kind"
    check "backup of a real save cut at a ${kind} point makes no archive" \
      bash -c '! env -u GAFFER_VALIDATOR GAFFER_SAVE_DIR="$0" GAFFER_MAX_WAIT_SECONDS=3 "$1" pre-install "cut-$2" >/dev/null 2>&1' "$work/cut-$kind" "$backup" "$kind"
  done
  check "the validator rejects a real save with extra bytes at the end" bash -c '
    mkdir "$1/extra" && cp "$2" "$1/extra/extra.sav" && echo EXTRA >>"$1/extra/extra.sav" && ! node "$0" "$1/extra" >/dev/null 2>&1' \
    "$here/validate-saves.mjs" "$work" "$real_save"
  check "nothing was published after the cut saves" test "$(pre_install_count)" -eq 1
}

# The reviewer's close-and-reopen probe, with the real save: a writer writes the first part,
# CLOSES the file, pauses for longer than the quiet period, then reopens it to append the rest.
test_real_save_close_and_reopen() {
  local archive
  fresh_backups
  rm -rf "$real_dir/server" && mkdir "$real_dir/server"
  ( cat "$work/cuts/boundary.sav" >"$real_dir/server/real.sav"
    sleep 6
    tail -c +$((boundary_at + 1)) "$real_save" >>"$real_dir/server/real.sav" ) &
  writer_pid=$!
  sleep 0.5
  GAFFER_QUIET_SECONDS=2 GAFFER_MAX_WAIT_SECONDS=60 real_backup "$backup" pre-install close-reopen >/dev/null 2>&1 || true
  wait "$writer_pid"
  archive=$(find "$work/backups/pre-install" -name 'saves-*-close-reopen.tar')
  check "the archive from the probe holds the complete real save" bash -c '
    [ -z "$0" ] || { "$1" "$0" "$2" >/dev/null && cmp "$3" "$2/SaveGames/server/real.sav"; }' \
    "$archive" "$here/restore-saves.sh" "$work/restored-reopen" "$real_save"
  check "the backup waited for the writer and made an archive" test -n "$archive"
}

run_group_1() {
  test_validator_rejects_garbage
  test_real_validator_blocks_garbage_backup
  test_backup_waits_for_validator
  test_backup_gives_up_on_validator
  test_validator_cannot_run
}

run_group_2() {
  if [ -z "$real_save" ] || [ ! -f "$real_save" ]; then
    echo "skip the real-save tests: set GAFFER_TEST_REAL_SAVE to the path of one real .sav file"
    return 0
  fi
  prepare_real
  test_real_save_passes
  test_real_save_cuts_fail
  test_real_save_close_and_reopen
}

make_fake_saves
if [ "$#" -gt 0 ]; then
  if [ -n "$real_save" ]; then prepare_real; fi
  "$@"
else
  run_group_1
  run_group_2
fi
echo "all $passed checks passed"
