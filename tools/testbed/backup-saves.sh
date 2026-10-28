#!/usr/bin/env bash
# Archives the whole Satisfactory SaveGames directory into a dated tar file with a
# sha256 sidecar, and rotates the scheduled ("daily") archives. A "pre-install" archive
# lives in its own directory that the rotation never reads, so it is never deleted.
# It refuses to copy while any process holds a save open for writing, because a writer
# can pause for any length of time and a quiet period cannot prove a save is complete.
# Restoring is left to restore-saves.sh. See tools/testbed/README.md for the runbook.
#
# Usage:  backup-saves.sh daily
#         backup-saves.sh pre-install <label>
set -euo pipefail
umask 077

SAVE_DIR=${GAFFER_SAVE_DIR:-/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames}
# /proc shows the resolved path of an open file, so the scan needs the resolved directory.
REAL_SAVE_DIR=$(realpath -m -- "$SAVE_DIR")
BACKUP_DIR=${GAFFER_BACKUP_DIR:-/home/satisfactory/save-backups}
KEEP_DAILY=${GAFFER_KEEP_DAILY:-14}
# A save also counts as "being written" while it changed less than this many seconds ago.
# This is a second, cheap guard. The open-for-write scan below is the one that decides.
QUIET_SECONDS=${GAFFER_QUIET_SECONDS:-15}
MAX_WAIT_SECONDS=${GAFFER_MAX_WAIT_SECONDS:-120}
COPY_ATTEMPTS=${GAFFER_COPY_ATTEMPTS:-5}
MIN_FREE_MB=${GAFFER_MIN_FREE_MB:-1024}
ALLOW_UNINSPECTABLE=${GAFFER_ALLOW_UNINSPECTABLE:-0}

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
  local free_mb
  free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')
  [ "$free_mb" -ge "$MIN_FREE_MB" ] || fail "only ${free_mb} MB free in $BACKUP_DIR (need $MIN_FREE_MB)"
}

# Lists every file descriptor, in any visible process, that holds a save open for write
# (O_WRONLY or O_RDWR). The low two bits of the octal "flags" line in fdinfo are the access
# mode, so a process that only reads a save (foreman-save-sync) is not reported.
open_for_write() {
  local link info flags
  while IFS= read -r -d '' link; do
    info="${link/\/fd\//\/fdinfo\/}"
    flags=$(awk '/^flags:/ { print $2 }' "$info" 2>/dev/null) || continue
    [[ "$flags" =~ ^[0-7]+$ ]] || continue
    if [ $((8#$flags & 3)) -ne 0 ]; then echo "$link -> $(readlink "$link")"; fi
  done < <(find /proc/[0-9]*/fd -maxdepth 1 -lname "$REAL_SAVE_DIR/*" -print0 2>/dev/null)
}

# Fail closed. The scan can only see the descriptors of processes it may inspect. If a
# process of the saves' owner (the game) is hidden from this user, the scan would say
# "no writer" for the wrong reason, so refuse to run instead. A helper that marks itself
# non-dumpable (for example "(sd-pam)") also trips this; GAFFER_ALLOW_UNINSPECTABLE=1 is
# the explicit, logged opt-out for a machine that has such a helper (the tests use it).
require_process_visibility() {
  local owner proc
  if [ "$ALLOW_UNINSPECTABLE" = 1 ]; then
    echo "backup-saves: warning: not checking that every process can be inspected" >&2
    return 0
  fi
  owner=$(stat -c %u "$SAVE_DIR")
  for proc in /proc/[0-9]*; do
    [ "$(stat -c %u "$proc" 2>/dev/null || echo gone)" = "$owner" ] || continue
    ls "$proc/fd" >/dev/null 2>&1 || [ ! -d "$proc" ] ||
      fail "cannot inspect process ${proc#/proc/} of the saves' owner; run as that user or as root"
  done
}

# A save is "busy" if a process holds it open for write, or if it changed in the last
# QUIET_SECONDS. Wait for neither, but give up after MAX_WAIT_SECONDS so a stuck writer
# cannot hang the timer. The open-for-write scan is the real test; the quiet period only
# covers a writer that closes and reopens a file between writes.
is_busy() {
  if [ -n "$(open_for_write)" ]; then return 0; fi
  [ "$QUIET_SECONDS" -gt 0 ] &&
    [ -n "$(find "$SAVE_DIR" -type f -newermt "$QUIET_SECONDS seconds ago" -print -quit)" ]
}

wait_for_idle() {
  local waited=0
  while is_busy; do
    [ "$waited" -lt "$MAX_WAIT_SECONDS" ] ||
      fail "saves still being written after ${MAX_WAIT_SECONDS}s; no archive made. $(open_for_write | head -n 3 | tr '\n' ';')"
    sleep 1
    waited=$((waited + 1))
  done
}

# Copy, then prove the copy is whole. The copy is accepted only if no process holds a save
# open for write, no file changed after the copy began (marker file), and every file equals
# its source (diff). Otherwise retry.
snapshot_saves() {
  local attempt marker
  marker="$staging/.copy-started"
  for ((attempt = 1; attempt <= COPY_ATTEMPTS; attempt++)); do
    wait_for_idle
    rm -rf "${staging:?}/SaveGames"
    mkdir "$staging/SaveGames"
    touch "$marker"
    cp -a "$SAVE_DIR/." "$staging/SaveGames/"
    if [ -z "$(open_for_write)" ] &&
      [ -z "$(find "$SAVE_DIR" -type f -newer "$marker" -print -quit)" ] &&
      diff -r "$SAVE_DIR" "$staging/SaveGames" >/dev/null; then
      return 0
    fi
    echo "backup-saves: saves changed during copy (attempt $attempt of $COPY_ATTEMPTS)" >&2
  done
  fail "could not take a stable copy; no archive made"
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
  require_process_visibility
  staging=$(mktemp -d "$BACKUP_DIR/.staging.XXXXXX")
  trap cleanup EXIT
  snapshot_saves
  write_archive "$mode" "$label"
  if [ "$mode" = "daily" ]; then rotate_daily; fi
}

main "$@"
