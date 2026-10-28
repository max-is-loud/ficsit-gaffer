#!/usr/bin/env bash
# Restores a backup-saves.sh archive into a NEW directory so a person can check it first.
# It never writes into the live SaveGames directory: a real restore is a manual,
# server-stopped step in tools/testbed/README.md.
#
# Usage:  restore-saves.sh <archive.tar> <new-or-empty-directory>
set -euo pipefail
# Same mask as satisfactory.service (UMask=0027): foreman-save-sync reads the saves through
# the group, so a restored copy must keep group read access.
umask 027

LIVE_SAVE_DIR=${GAFFER_SAVE_DIR:-/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames}

fail() {
  echo "restore-saves: $*" >&2
  exit 1
}

# The destination must not overlap the live directory, in either direction.
refuse_live_overlap() {
  local destination live
  destination=$(realpath -m -- "$1")
  live=$(realpath -m -- "$LIVE_SAVE_DIR")
  case "$destination/" in "$live"/*) fail "destination is inside the live save directory" ;; esac
  case "$live/" in "$destination"/*) fail "destination contains the live save directory" ;; esac
}

# Reject absolute paths and ".." so a bad archive cannot write outside the destination.
refuse_unsafe_entries() {
  if tar -tf "$1" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "archive has an unsafe path"
  fi
}

main() {
  [ "$#" -eq 2 ] || { echo "usage: restore-saves.sh <archive.tar> <new-or-empty-directory>" >&2; exit 2; }
  local archive=$1 destination=$2
  [ -f "$archive" ] || fail "archive not found: $archive"
  [ -f "$archive.sha256" ] || fail "checksum file not found: $archive.sha256"
  refuse_live_overlap "$destination"
  if [ -e "$destination" ]; then
    [ -d "$destination" ] && [ -z "$(ls -A "$destination")" ] || fail "destination exists and is not empty: $destination"
  fi
  (cd "$(dirname "$archive")" && sha256sum --check --status "$(basename "$archive").sha256") ||
    fail "checksum does not match: the archive is damaged"
  refuse_unsafe_entries "$archive"
  mkdir -p "$destination"
  tar -xf "$archive" -C "$destination" --no-same-owner
  echo "restored into $destination/SaveGames"
  (cd "$destination/SaveGames" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
}

main "$@"
