#!/usr/bin/env bash
# Archives the whole Satisfactory SaveGames directory into a dated tar file with a
# sha256 sidecar, and rotates the scheduled ("daily") archives. A "pre-install" archive
# lives in its own directory that the rotation never reads, so it is never deleted.
# Two guards keep it from archiving a save that a writer has not finished. First it waits
# while any process holds a save open for writing (or cannot be inspected). Second it runs
# validate-saves.mjs on the staged copy, so a save that is not complete never reaches an
# archive, even if the writer closed the file and will append to it later.
# Restoring is left to restore-saves.sh. See tools/testbed/README.md for the runbook.
#
# Usage:  backup-saves.sh daily
#         backup-saves.sh pre-install <label>
set -euo pipefail
umask 077

SAVE_DIR=${GAFFER_SAVE_DIR:-/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames}
# /proc shows the resolved path of an open file, so the scan needs the resolved directory.
REAL_SAVE_DIR=$(realpath -m -- "$SAVE_DIR")
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKUP_DIR=${GAFFER_BACKUP_DIR:-/home/satisfactory/save-backups}
KEEP_DAILY=${GAFFER_KEEP_DAILY:-14}
# A save also counts as "being written" while it changed less than this many seconds ago.
# This is only a cheap extra guard. The scan and the validator decide.
QUIET_SECONDS=${GAFFER_QUIET_SECONDS:-15}
MAX_WAIT_SECONDS=${GAFFER_MAX_WAIT_SECONDS:-120}
COPY_ATTEMPTS=${GAFFER_COPY_ATTEMPTS:-5}
MIN_FREE_MB=${GAFFER_MIN_FREE_MB:-1024}
# Names (/proc/<pid>/comm, joined with "|") of processes that the scan may skip when it
# cannot inspect them, for example "(sd-pam)" on a login machine. Empty on the server.
UNINSPECTABLE_OK_COMMS=${GAFFER_UNINSPECTABLE_OK_COMMS:-}
# The validator is "node validate-saves.mjs" unless GAFFER_VALIDATOR names another program.
# Files that are not game saves are skipped by name (the server settings file).
VALIDATOR=${GAFFER_VALIDATOR:-}
VALIDATE_SKIP=${GAFFER_VALIDATE_SKIP:-ServerSettings.*.sav}
VALIDATE_RETRY_SECONDS=${GAFFER_VALIDATE_RETRY_SECONDS:-5}
OWNER_UID=""

staging=""

fail() {
  echo "backup-saves: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$staging" ]; then rm -rf "$staging"; fi
}

usage() {
  echo "usage: backup-saves.sh daily | pre-install <label>" >&2
  exit 2
}

# The checks run before any copy, so a bad setting fails fast and changes nothing.
validate_settings() {
  [ -d "$SAVE_DIR" ] || fail "save directory not found: $SAVE_DIR"
  [ -n "$(find "$SAVE_DIR" -type f -print -quit)" ] || fail "save directory has no files: $SAVE_DIR"
  [[ "$KEEP_DAILY" =~ ^[1-9][0-9]*$ ]] || fail "GAFFER_KEEP_DAILY must be a positive integer"
  [[ "$QUIET_SECONDS" =~ ^[0-9]+$ ]] || fail "GAFFER_QUIET_SECONDS must be a whole number"
  [[ "$MAX_WAIT_SECONDS" =~ ^[0-9]+$ ]] || fail "GAFFER_MAX_WAIT_SECONDS must be a whole number"
  [[ "$COPY_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "GAFFER_COPY_ATTEMPTS must be a positive integer"
  [[ "$VALIDATE_RETRY_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "GAFFER_VALIDATE_RETRY_SECONDS must be a positive integer"
  local free_mb
  free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')
  [ "$free_mb" -ge "$MIN_FREE_MB" ] || fail "only ${free_mb} MB free in $BACKUP_DIR (need $MIN_FREE_MB)"
}

# True if the process is allowed to be skipped when it cannot be inspected.
comm_is_skippable() {
  local comm
  comm=$(cat "/proc/$1/comm" 2>/dev/null) || return 0
  case "|$UNINSPECTABLE_OK_COMMS|" in *"|$comm|"*) return 0 ;; esac
  return 1
}

# Prints one line for each reason the saves may not be complete. Any failure to look counts
# as a reason ("fail closed"), on every scan, because a writer can become uninspectable
# after an earlier scan (for example by marking itself non-dumpable).
#   1. A process of the saves' owner (the game) whose descriptors cannot be listed.
#   2. A descriptor that points into the saves with a write or read-write access mode, or
#      whose access mode cannot be read. The low two bits of the octal "flags" line in
#      fdinfo are the access mode, so a process that only reads a save
#      (foreman-save-sync) is not reported.
busy_reasons() {
  local proc pid link info flags
  for proc in /proc/[0-9]*; do
    [ "$(stat -c %u "$proc" 2>/dev/null)" = "$OWNER_UID" ] || continue
    ls "$proc/fd" >/dev/null 2>&1 && continue
    pid=${proc#/proc/}
    # A process that exited, or a zombie, has nothing to inspect.
    [ -d "$proc" ] && ! grep -q '^State:[[:space:]]*Z' "$proc/status" 2>/dev/null || continue
    comm_is_skippable "$pid" || echo "process $pid ($(cat "$proc/comm" 2>/dev/null)) cannot be inspected"
  done
  while IFS= read -r -d '' link; do
    info="${link/\/fd\//\/fdinfo\/}"
    flags=$(awk '/^flags:/ { print $2 }' "$info" 2>/dev/null) || flags=""
    if [[ ! "$flags" =~ ^[0-7]+$ ]]; then
      if [ -L "$link" ]; then echo "$link: access mode cannot be read"; fi
    elif [ $((8#$flags & 3)) -ne 0 ]; then
      echo "$link -> $(readlink "$link") is open for write"
    fi
  done < <(find /proc/[0-9]*/fd -maxdepth 1 -lname "$REAL_SAVE_DIR/*" -print0 2>/dev/null)
}

# A save is "busy" while busy_reasons says so, or if it changed in the last QUIET_SECONDS.
# Wait for neither, but give up after MAX_WAIT_SECONDS so a stuck writer cannot hang the
# timer. The quiet period only covers a writer that closes and reopens a file between writes.
is_busy() {
  if [ -n "$(busy_reasons)" ]; then return 0; fi
  [ "$QUIET_SECONDS" -gt 0 ] &&
    [ -n "$(find "$SAVE_DIR" -type f -newermt "$QUIET_SECONDS seconds ago" -print -quit)" ]
}

wait_for_idle() {
  local waited=0
  while is_busy; do
    [ "$waited" -lt "$MAX_WAIT_SECONDS" ] ||
      fail "saves still being written after ${MAX_WAIT_SECONDS}s; no archive made. $(busy_reasons | head -n 3 | tr '\n' ';')"
    sleep 1
    waited=$((waited + 1))
  done
}

# Runs the validator on a directory. Prints its messages on stderr. Exit codes: 0 every save
# is complete, 1 a save is not (or does not parse), 2 the validator could not run.
run_validator() {
  if [ -n "$VALIDATOR" ]; then
    "$VALIDATOR" "$1" >&2
  else
    # The heap limit makes a garbage file fail fast instead of eating the host's memory.
    node --max-old-space-size=768 "$HERE/validate-saves.mjs" "$1" --skip "$VALIDATE_SKIP" >&2
  fi
}

# One copy attempt. True only if nothing wrote a save during the copy and the copy equals
# the source: no process holds a save open for write, no file changed after the copy began
# (marker file), and diff -r finds no difference.
copy_is_stable() {
  local marker="$staging/.copy-started"
  rm -rf "${staging:?}/SaveGames"
  mkdir "$staging/SaveGames"
  touch "$marker"
  cp -a "$SAVE_DIR/." "$staging/SaveGames/"
  [ -z "$(busy_reasons)" ] &&
    [ -z "$(find "$SAVE_DIR" -type f -newer "$marker" -print -quit)" ] &&
    diff -r "$SAVE_DIR" "$staging/SaveGames" >/dev/null
}

# Take a stable copy, then require every save in it to be complete. A save that is stable
# but incomplete may belong to a writer that closed the file and will append later, so wait
# and copy again, up to MAX_WAIT_SECONDS. The validator decides, not the clock.
snapshot_saves() {
  local copies=0 invalid_waited=0 status
  while true; do
    wait_for_idle
    if copy_is_stable; then
      status=0
      run_validator "$staging/SaveGames" || status=$?
      [ "$status" -ne 0 ] || return 0
      [ "$status" -ne 2 ] || fail "the save validator cannot run (is the parser installed? see README); no archive made"
      [ "$invalid_waited" -lt "$MAX_WAIT_SECONDS" ] ||
        fail "a save is incomplete or unreadable after ${MAX_WAIT_SECONDS}s; no archive made. If the game was updated, the parser may not read the new format (see README)."
      echo "backup-saves: a save is not complete; trying again in ${VALIDATE_RETRY_SECONDS}s" >&2
      sleep "$VALIDATE_RETRY_SECONDS"
      invalid_waited=$((invalid_waited + VALIDATE_RETRY_SECONDS))
    else
      copies=$((copies + 1))
      echo "backup-saves: saves changed during copy (attempt $copies of $COPY_ATTEMPTS)" >&2
      [ "$copies" -lt "$COPY_ATTEMPTS" ] || fail "could not take a stable copy; no archive made"
    fi
  done
}

# Delete only the oldest scheduled archives. Names sort by their UTC timestamp.
rotate_daily() {
  local archives=() surplus archive i
  while IFS= read -r archive; do archives+=("$archive"); done \
    < <(find "$BACKUP_DIR/daily" -maxdepth 1 -type f -name 'saves-*.tar' | sort)
  surplus=$((${#archives[@]} - KEEP_DAILY))
  for ((i = 0; i < surplus; i++)); do
    rm -f -- "${archives[$i]}" "${archives[$i]}.sha256"
    echo "backup-saves: rotated out ${archives[$i]}" >&2
  done
}

# Build the archive and its checksum in staging, and publish only when every step has
# succeeded. The sidecar goes first: if a publish is cut short, the leftover is a lone
# sidecar, which is not an archive. A failed publish removes what it moved.
write_archive() {
  local kind=$1 label=$2 name destination_dir
  name="saves-$(date -u +%Y%m%dT%H%M%SZ)${label:+-$label}.tar"
  destination_dir="$BACKUP_DIR/$kind"
  [ ! -e "$destination_dir/$name" ] || fail "archive already exists: $destination_dir/$name"
  tar -C "$staging" -cf "$staging/$name" SaveGames
  (cd "$staging" && sha256sum "$name" >"$name.sha256")
  [ -s "$staging/$name.sha256" ] || fail "checksum file is empty; no archive made"
  # Read-only is a guard against a casual delete; the real protection is the directory split.
  if [ "$kind" = "pre-install" ]; then chmod a-w "$staging/$name" "$staging/$name.sha256"; fi
  if ! mv "$staging/$name.sha256" "$destination_dir/" || ! mv "$staging/$name" "$destination_dir/"; then
    rm -f -- "$destination_dir/$name" "$destination_dir/$name.sha256"
    fail "could not publish the archive; nothing was kept"
  fi
  echo "$destination_dir/$name"
}

main() {
  local mode=${1:-} label=${2:-}
  case "$mode" in
    daily) [ -z "$label" ] || usage ;;
    pre-install) [[ "$label" =~ ^[A-Za-z0-9._-]+$ ]] || fail "label is required: letters, digits, dot, hyphen and underscore only" ;;
    *) usage ;;
  esac
  mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/pre-install"
  # One backup at a time: the timer and a manual run must not overlap.
  exec 9>"$BACKUP_DIR/.lock"
  flock -w 600 9 || fail "another backup holds the lock"
  validate_settings
  OWNER_UID=$(stat -c %u "$SAVE_DIR")
  staging=$(mktemp -d "$BACKUP_DIR/.staging.XXXXXX")
  trap cleanup EXIT
  snapshot_saves
  write_archive "$mode" "$label"
  if [ "$mode" = "daily" ]; then rotate_daily; fi
}

main "$@"
