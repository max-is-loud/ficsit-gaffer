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


# ---- Group 1b: a synthetic save, written with the library, so no real save is needed ----

# Writes a tiny valid save and the cuts of it that a half-finished writer could leave.
make_synthetic() {
  local info
  mkdir -p "$work/synth"
  info=$(node "$here/make-synthetic-save.mjs" "$work/synth/full.sav")
  synth_length=$(sed -E 's/.*length=([0-9]+).*/\1/' <<<"$info")
  synth_header_end=$(sed -E 's/.*header_end=([0-9]+).*/\1/' <<<"$info")
  synth_boundary=$(sed -E 's/.*boundary=([0-9]+).*/\1/' <<<"$info")
  synth_mid=$(sed -E 's/.*mid=([0-9]+).*/\1/' <<<"$info")
  head -c "$synth_boundary" "$work/synth/full.sav" >"$work/synth/prefix-boundary.sav"
  tail -c +$((synth_boundary + 1)) "$work/synth/full.sav" >"$work/synth/rest-boundary.sav"
}

# Makes a SaveGames-like tree: one complete world save, and the extra files that a test names.
synth_tree() {
  local tree=$1
  rm -rf "$tree" && mkdir -p "$tree/server"
  cp "$work/synth/full.sav" "$tree/server/world.sav"
  touch -d '10 minutes ago' "$tree/server/world.sav"
}

validator_accepts() { node "$here/validate-saves.mjs" "$1" >/dev/null 2>&1; }
validator_rejects() { ! node "$here/validate-saves.mjs" "$1" >/dev/null 2>&1; }

test_synthetic_validator() {
  local tree="$work/synth-check" cut
  synth_tree "$tree"
  check "the validator accepts the complete synthetic save" validator_accepts "$tree"
  for cut in "$synth_header_end" "$synth_mid" "$synth_boundary" $((synth_length - 1)); do
    rm -rf "$tree" && mkdir -p "$tree"
    head -c "$cut" "$work/synth/full.sav" >"$tree/cut.sav"
    check "the validator rejects the synthetic save cut at byte $cut of $synth_length" validator_rejects "$tree"
  done
  cp "$work/synth/full.sav" "$tree/cut.sav" && echo X >>"$tree/cut.sav"
  check "the validator rejects the synthetic save with an extra byte at the end" validator_rejects "$tree"
}

# Only the settings file in the top folder is exempt. The same name anywhere else is a save.
test_settings_file_rule() {
  local tree="$work/settings-rule"
  synth_tree "$tree"
  printf 'server options, not a world' >"$tree/ServerSettings.7777.sav"
  check "the top-level ServerSettings.<port>.sav is not validated" validator_accepts "$tree"
  cp "$work/synth/prefix-boundary.sav" "$tree/server/ServerSettings.partial.sav"
  check "a partial save named ServerSettings.partial.sav in a subfolder is rejected" validator_rejects "$tree"
  rm "$tree/server/ServerSettings.partial.sav"
  printf 'junk' >"$tree/server/ServerSettings.7777.sav"
  check "ServerSettings.7777.sav in a subfolder is validated" validator_rejects "$tree"
  rm "$tree/server/ServerSettings.7777.sav"
  cp "$work/synth/prefix-boundary.sav" "$tree/ServerSettings.partial.sav"
  check "a partial save named ServerSettings.partial.sav in the top folder is rejected" validator_rejects "$tree"
  rm -r "$tree/server" "$tree/ServerSettings.partial.sav"
  check "the validator fails when only the settings file is left" validator_rejects "$tree"
}

# R1-01: the settings-file name must not let a partial save into an archive.
test_backup_rejects_partial_settings_name() {
  local tree="$work/partial-name"
  fresh_backups
  synth_tree "$tree"
  cp "$work/synth/prefix-boundary.sav" "$tree/server/ServerSettings.partial.sav"
  touch -d '10 minutes ago' "$tree/server/ServerSettings.partial.sav"
  check "backup makes no archive from a partial save named ServerSettings.partial.sav" \
    bash -c '! env -u GAFFER_VALIDATOR GAFFER_SAVE_DIR="$0" GAFFER_MAX_WAIT_SECONDS=3 "$1" pre-install partial-name >/dev/null 2>&1' "$tree" "$backup"
  check "nothing was published for the partial save" nothing_published
}

# R2-01: the validator is the only gate, whatever the writer's visibility. A writer writes a
# prefix, keeps the file open, hides itself (non-dumpable, so /proc/<pid>/fd is unreadable),
# pauses, then appends the rest. The copy of the prefix fails to parse, so the backup waits for
# the complete file or gives up without an archive. The writer hides after 2 s, or at once
# when something lists its descriptors (a stand-in "ls" fires the trigger). The trigger
# reproduces a hide that falls between two looks of a scan, which the reviewer found in the
# old /proc scan. The current script does not scan, so only the 2 s timer applies to it.
hidden_writer() {
  local target=$1
  mkdir -p "$work/bin" "$work/shim"
  ln -sf "$(command -v python3)" "$work/bin/hidden-writer"
  rm -f "$work/hide-now"
  printf '#!/bin/sh\n/bin/ls "$@"\nstatus=$?\nif [ "$1" = "/proc/$(cat "%s/hidden.pid" 2>/dev/null)/fd" ]; then touch "%s/hide-now"; sleep 0.3; fi\nexit $status\n' \
    "$work" "$work" >"$work/shim/ls"
  chmod +x "$work/shim/ls"
  export PATH="$work/shim:$PATH"
  "$work/bin/hidden-writer" -c '
import ctypes, os, sys, time
target, prefix, rest, trigger, pidfile = sys.argv[1:6]
open(pidfile, "w").write(str(os.getpid()))
handle = open(target, "wb")
handle.write(open(prefix, "rb").read()); handle.flush()
for _ in range(200):
    if os.path.exists(trigger):
        break
    time.sleep(0.01)
ctypes.CDLL(None).prctl(4, 0)  # PR_SET_DUMPABLE = 0: /proc/<pid>/fd is now unreadable
time.sleep(5)
handle.write(open(rest, "rb").read()); handle.close()
' "$target" "$work/synth/prefix-boundary.sav" "$work/synth/rest-boundary.sav" "$work/hide-now" "$work/hidden.pid" &
  writer_pid=$!
  sleep 0.5
}

test_hidden_writer_makes_no_partial_archive() {
  local tree="$work/hidden-a"
  command -v python3 >/dev/null || { echo "skip the hidden-writer tests: python3 is missing"; return 0; }
  fresh_backups
  synth_tree "$tree"
  hidden_writer "$tree/server/ServerSettings.partial.sav"
  check "backup makes no archive while a hidden writer holds a partial save" \
    bash -c '! env -u GAFFER_VALIDATOR GAFFER_QUIET_SECONDS=0 GAFFER_SAVE_DIR="$0" GAFFER_MAX_WAIT_SECONDS=3 "$1" pre-install hidden-a >/dev/null 2>&1' "$tree" "$backup"
  wait "$writer_pid"
  check "nothing was published while the writer was hidden" nothing_published
}

test_hidden_writer_archive_is_complete() {
  local tree="$work/hidden-b" archive
  command -v python3 >/dev/null || { echo "skip the hidden-writer tests: python3 is missing"; return 0; }
  fresh_backups
  synth_tree "$tree"
  hidden_writer "$tree/server/ServerSettings.partial.sav"
  env -u GAFFER_VALIDATOR GAFFER_QUIET_SECONDS=0 GAFFER_SAVE_DIR="$tree" GAFFER_MAX_WAIT_SECONDS=60 \
    "$backup" pre-install hidden-b >/dev/null 2>&1 || true
  wait "$writer_pid"
  archive=$(find "$work/backups/pre-install" -name 'saves-*-hidden-b.tar')
  check "the backup waited and made an archive after the hidden writer finished" test -n "$archive"
  "$here/restore-saves.sh" "$archive" "$work/restored-hidden" >/dev/null
  check "the archive holds the complete save" cmp "$work/synth/full.sav" "$work/restored-hidden/SaveGames/server/ServerSettings.partial.sav"
}

# A complete synthetic save is archived and restores byte for byte.
test_synthetic_backup_roundtrip() {
  local tree="$work/roundtrip" archive
  fresh_backups
  synth_tree "$tree"
  printf 'server options' >"$tree/ServerSettings.7777.sav"
  check "backup of a complete synthetic save makes an archive" \
    env -u GAFFER_VALIDATOR GAFFER_SAVE_DIR="$tree" "$backup" pre-install roundtrip
  archive=$(find "$work/backups/pre-install" -name 'saves-*-roundtrip.tar')
  "$here/restore-saves.sh" "$archive" "$work/restored-roundtrip" >/dev/null
  check "the restored tree equals the source byte for byte" diff -r "$tree" "$work/restored-roundtrip/SaveGames"
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
  check "the validator accepts the complete real save" validator_accepts "$real_dir"
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
  make_synthetic
  test_synthetic_validator
  test_settings_file_rule
  test_backup_rejects_partial_settings_name
  test_hidden_writer_makes_no_partial_archive
  test_hidden_writer_archive_is_complete
  test_synthetic_backup_roundtrip
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
  make_synthetic
  if [ -n "$real_save" ]; then prepare_real; fi
  "$@"
else
  run_group_1
  run_group_2
fi
echo "all $passed checks passed"
