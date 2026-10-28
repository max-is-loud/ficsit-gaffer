#!/usr/bin/env bash
# Archives the whole Satisfactory SaveGames directory into a dated tar file with a
# sha256 sidecar, and rotates the scheduled ("daily") archives. A "pre-install" archive
# lives in its own directory that the rotation never reads, so it is never deleted.
# Restoring is left to restore-saves.sh. See tools/testbed/README.md for the runbook.
#
# Usage:  backup-saves.sh daily
#         backup-saves.sh pre-install <label>
set -euo pipefail
umask 077

SAVE_DIR=${GAFFER_SAVE_DIR:-/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames}
BACKUP_DIR=${GAFFER_BACKUP_DIR:-/home/satisfactory/save-backups}
KEEP_DAILY=${GAFFER_KEEP_DAILY:-14}
# A save counts as "being written" while it changed less than this many seconds ago.
QUIET_SECONDS=${GAFFER_QUIET_SECONDS:-15}
MAX_WAIT_SECONDS=${GAFFER_MAX_WAIT_SECONDS:-120}
COPY_ATTEMPTS=${GAFFER_COPY_ATTEMPTS:-5}
MIN_FREE_MB=${GAFFER_MIN_FREE_MB:-1024}

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

# A file is "busy" if the game changed it in the last QUIET_SECONDS. Wait for quiet,
# but give up after MAX_WAIT_SECONDS so a stuck writer cannot hang the timer.
wait_for_quiet() {
  local waited=0
  while [ "$QUIET_SECONDS" -gt 0 ] &&
    [ -n "$(find "$SAVE_DIR" -type f -newermt "$QUIET_SECONDS seconds ago" -print -quit)" ]; do
    [ "$waited" -lt "$MAX_WAIT_SECONDS" ] || fail "saves still changing after ${MAX_WAIT_SECONDS}s; no archive made"
    sleep 1
    waited=$((waited + 1))
  done
}

# Copy, then prove the copy is whole. The copy is accepted only if no file changed after
# it began (marker file) and every file equals its source (diff). Otherwise retry.
snapshot_saves() {
  local attempt marker
  marker="$staging/.copy-started"
  for ((attempt = 1; attempt <= COPY_ATTEMPTS; attempt++)); do
    wait_for_quiet
    rm -rf "${staging:?}/SaveGames"
    mkdir "$staging/SaveGames"
    touch "$marker"
    cp -a "$SAVE_DIR/." "$staging/SaveGames/"
    if [ -z "$(find "$SAVE_DIR" -type f -newer "$marker" -print -quit)" ] &&
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

write_archive() {
  local kind=$1 label=$2 name destination_dir final
  name="saves-$(date -u +%Y%m%dT%H%M%SZ)${label:+-$label}.tar"
  destination_dir="$BACKUP_DIR/$kind"
  final="$destination_dir/$name"
  [ ! -e "$final" ] || fail "archive already exists: $final"
  tar -C "$staging" -cf "$staging/$name" SaveGames
  mv "$staging/$name" "$final"
  (cd "$destination_dir" && sha256sum "$name" >"$name.sha256")
  # Read-only is a guard against a casual delete; the real protection is the directory split.
  if [ "$kind" = "pre-install" ]; then chmod a-w "$final" "$final.sha256"; fi
  echo "$final"
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
  staging=$(mktemp -d "$BACKUP_DIR/.staging.XXXXXX")
  trap cleanup EXIT
  snapshot_saves
  write_archive "$mode" "$label"
  if [ "$mode" = "daily" ]; then rotate_daily; fi
}

main "$@"
