#!/usr/bin/env bash
# Switches the mods of the game server on and off, and keeps them off on a game build that
# nobody has approved. "Off" means that FactoryGame/Mods is renamed to Mods.off: the game then
# starts as a plain server. The `guard` command runs in satisfactory.service as an ExecStartPre,
# after steamcmd has updated the game. It compares the installed Steam build id with
# supported-builds: an unknown build gets no mods, so a game update can never start SML on a
# build that nobody has tested (user decision of 28 Oct 2026, issue #65). The build id comes
# from the Steam manifest, which steamcmd writes, so the guard sees the build it is about to start.
#
# Exit codes of `guard`. The guard may stop the game from starting in ONE case only: mods are
# present, the build is not approved (or cannot be read), and the mods cannot be moved away.
# Mods on an unapproved build can crash the game or write mod data into the save, and a stopped
# server protects the save. In every other case the guard exits 0. In particular, with no Mods
# folder (the mods are already off) it exits 0 whatever else fails, so a guard problem can
# never block a server that has no mods.
#
# `off` is idempotent: it succeeds when the mods are already off, so the rollback can always
# start the game again. Every move uses `mv -T`, so a move never goes INTO an existing folder.
# Names that this script can create under FactoryGame: Mods.off and Mods.off-<UTC stamp>.
# Runs as the game user (guard) or as root or the game user (the other commands).
# See tools/testbed/bridge-runbook.md.
#
# Usage:  mods-control.sh guard | status | on | off
set -euo pipefail

GAME_DIR=${GAFFER_GAME_DIR:-/home/satisfactory/server}
APPROVED_BUILDS=${GAFFER_APPROVED_BUILDS:-/etc/gaffer-bridge-game/supported-builds}
SYSTEMCTL=${GAFFER_SYSTEMCTL:-systemctl}
GAME_UNIT=${GAFFER_GAME_UNIT:-satisfactory.service}
MODS="$GAME_DIR/FactoryGame/Mods"
MODS_OFF="$GAME_DIR/FactoryGame/Mods.off"
MANIFEST="$GAME_DIR/steamapps/appmanifest_1690800.acf"

# A message must never change a result. The guard runs as an ExecStartPre, so a failed write
# (a full or closed output) must not stop the game: both helpers ignore a write error.
say() { echo "mods-control: $*" || true; }
warn() { echo "mods-control: $*" >&2 || true; }

fail() {
  echo "mods-control: $*" >&2
  exit 1
}

# Empty output means that the build is unknown.
installed_build() {
  awk '$1 == "\"buildid\"" { gsub(/"/, "", $2); print $2; exit }' "$MANIFEST" 2>/dev/null || true
}

# The build id must be digits only, and it must match a whole line of the approved list
# (comments and blanks ignored). grep reads all of its input, so no pipe closes early.
build_is_approved() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ -r "$APPROVED_BUILDS" ] && sed 's/#.*//; s/[[:space:]]//g' "$APPROVED_BUILDS" | grep -x -- "$1" >/dev/null
}

refuse_while_running() {
  if "$SYSTEMCTL" is-active --quiet "$GAME_UNIT"; then fail "$GAME_UNIT is running; stop it first"; fi
}

# Moves Mods aside to Mods.off, or to Mods.off-<stamp> when Mods.off exists. It prints the
# new folder name, and fails only when the move fails: a failed `date` gets a fallback stamp,
# and a failed print after a good move still returns 0. mv -T never moves INTO a folder.
move_mods_aside() {
  local target=$MODS_OFF stamp=""
  if [ -e "$target" ]; then
    stamp=$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null) || stamp=""
    target="$MODS_OFF-${stamp:-pid$$-$RANDOM}"
  fi
  mv -T -- "$MODS" "$target" || return 1
  printf '%s\n' "${target##*/}" || true
  return 0
}

# Unlike `off`, this must work while the unit is starting. An unreadable manifest or list means
# "not approved", so the only step that can fail the guard is the move itself.
guard() {
  local build target
  # A closed output pipe must not kill the guard with SIGPIPE either.
  trap '' PIPE
  if [ ! -d "$MODS" ]; then say "no Mods directory; nothing to guard"; return 0; fi
  build=$(installed_build)
  if build_is_approved "$build"; then
    say "game build $build is approved; mods stay on"
    return 0
  fi
  if target=$(move_mods_aside); then
    say "game build '${build:-unknown}' is not in $APPROVED_BUILDS; moved Mods to $target. The server starts WITHOUT mods."
    return 0
  fi
  warn "REFUSING TO START THE GAME: build '${build:-unknown}' is not approved for mods, and $MODS cannot be moved away. See 'If the guard refuses the start' in tools/testbed/bridge-runbook.md."
  return 1
}

status() {
  local build
  build=$(installed_build)
  say "game build: ${build:-unknown}"
  if build_is_approved "$build"; then say "this build is approved for mods"; else say "this build is NOT approved for mods"; fi
  if [ -d "$MODS" ]; then say "mods are ON ($MODS)"; else say "mods are OFF"; fi
  if [ -d "$MODS_OFF" ]; then say "disabled mods are in $MODS_OFF"; fi
  return 0
}

switch_off() {
  local target
  refuse_while_running
  if [ ! -d "$MODS" ]; then say "mods are already off (no $MODS); nothing to do"; return 0; fi
  target=$(move_mods_aside) || fail "could not move $MODS away"
  say "mods are OFF (moved to $target); the next start is a plain server"
}

switch_on() {
  local build
  refuse_while_running
  [ -d "$MODS_OFF" ] || fail "no $MODS_OFF to switch on"
  [ ! -e "$MODS" ] || fail "$MODS already exists"
  build=$(installed_build)
  build_is_approved "$build" || fail "game build '${build:-unknown}' is not in $APPROVED_BUILDS; add it only after SML and the bridge support it"
  mv -- "$MODS_OFF" "$MODS"
  say "mods are ON for build $build; the next start loads them"
}

case "${1:-}" in
  guard) guard ;;
  status) status ;;
  off) switch_off ;;
  on) switch_on ;;
  *) echo "usage: mods-control.sh guard | status | on | off" >&2; exit 2 ;;
esac
