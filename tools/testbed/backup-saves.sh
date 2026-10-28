#!/usr/bin/env bash
# Archives the whole Satisfactory SaveGames directory into a dated tar file with a
# sha256 sidecar, and rotates the scheduled ("daily") archives. A "pre-install" archive
# lives in its own directory that the rotation never reads, so it is never deleted.
# The gate is validate-saves.mjs: it parses every save in the staged copy, so a save that
# is not complete never reaches an archive, whoever writes it and however it pauses. A quiet
# period, a "changed after the copy began" check and a final diff -r only keep the copy
# consistent; they never decide that a save is complete.
# Restoring is left to restore-saves.sh. See tools/testbed/README.md for the runbook.
#
# Usage:  backup-saves.sh daily
#         backup-saves.sh pre-install <label>
set -euo pipefail
umask 077

SAVE_DIR=${GAFFER_SAVE_DIR:-/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKUP_DIR=${GAFFER_BACKUP_DIR:-/home/satisfactory/save-backups}
KEEP_DAILY=${GAFFER_KEEP_DAILY:-14}
# Copy only when no file changed in the last QUIET_SECONDS. This saves needless retries. It
# is not a completeness test: a writer can stop for longer than any threshold.
QUIET_SECONDS=${GAFFER_QUIET_SECONDS:-15}
MAX_WAIT_SECONDS=${GAFFER_MAX_WAIT_SECONDS:-120}
COPY_ATTEMPTS=${GAFFER_COPY_ATTEMPTS:-5}
MIN_FREE_MB=${GAFFER_MIN_FREE_MB:-1024}
# The validator is "node validate-saves.mjs" unless GAFFER_VALIDATOR names another program.
VALIDATOR=${GAFFER_VALIDATOR:-}
VALIDATE_RETRY_SECONDS=${GAFFER_VALIDATE_RETRY_SECONDS:-5}

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

# "Busy" means a file changed in the last QUIET_SECONDS. Wait for quiet, but give up after
# MAX_WAIT_SECONDS so a stuck writer cannot hang the timer.
is_busy() {
  [ "$QUIET_SECONDS" -gt 0 ] &&
    [ -n "$(find "$SAVE_DIR" -type f -newermt "$QUIET_SECONDS seconds ago" -print -quit)" ]
}

wait_for_quiet() {
  local waited=0
  while is_busy; do
    [ "$waited" -lt "$MAX_WAIT_SECONDS" ] || fail "saves still changing after ${MAX_WAIT_SECONDS}s; no archive made"
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
    node --max-old-space-size=768 "$HERE/validate-saves.mjs" "$1" >&2
  fi
}

# One copy attempt. True only if the copy equals the source and nothing changed during it:
# no file changed after the copy began (marker file), and diff -r finds no difference.
copy_is_stable() {
  local marker="$staging/.copy-started"
  rm -rf "${staging:?}/SaveGames"
  mkdir "$staging/SaveGames"
  touch "$marker"
  cp -a "$SAVE_DIR/." "$staging/SaveGames/"
  [ -z "$(find "$SAVE_DIR" -type f -newer "$marker" -print -quit)" ] &&
    diff -r "$SAVE_DIR" "$staging/SaveGames" >/dev/null
}

# Take a stable copy, then require every save in it to be complete. A save that is stable
# but incomplete may belong to a writer that closed the file and will append later, so wait
# and copy again, up to MAX_WAIT_SECONDS. The validator decides, not the clock.
snapshot_saves() {
  local copies=0 invalid_waited=0 status
  while true; do
    wait_for_quiet
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
  staging=$(mktemp -d "$BACKUP_DIR/.staging.XXXXXX")
  trap cleanup EXIT
  snapshot_saves
  write_archive "$mode" "$label"
  if [ "$mode" = "daily" ]; then rotate_daily; fi
}

main "$@"
