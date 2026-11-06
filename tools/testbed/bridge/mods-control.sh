#!/usr/bin/env bash
# Switches the mods of the game server on and off, and keeps them off on a game build that
# nobody has approved. "Off" means that FactoryGame/Mods is renamed to Mods.off: the game then
# starts as a plain server. The `guard` command runs in satisfactory.service as an ExecStartPre,
# after steamcmd has updated the game. It compares the installed Steam build id with
# supported-builds: an unknown build gets no mods, so a game update can never start SML on a
# build that nobody has tested (user decision of 28 Oct 2026, issue #65). The build id comes
# from the Steam manifest, which steamcmd writes, so the guard sees the build it is about to start.
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

say() { echo "mods-control: $*"; }

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

# Unlike `off`, this must work while the unit is starting, and it must fail closed: if the
# rename fails, the game must not start with mods on an unapproved build.
guard() {
  local build target
  [ -d "$MODS" ] || { say "no Mods directory; nothing to guard"; return 0; }
  build=$(installed_build)
  if build_is_approved "$build"; then
    say "game build $build is approved; mods stay on"
    return 0
  fi
  target=$MODS_OFF
  if [ -e "$target" ]; then target="$MODS_OFF-$(date -u +%Y%m%dT%H%M%SZ)"; fi
  mv -- "$MODS" "$target" || fail "could not move $MODS away; refusing to start mods on an unapproved build"
  say "game build '${build:-unknown}' is not in $APPROVED_BUILDS; moved Mods to $(basename "$target"). The server starts WITHOUT mods."
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
  refuse_while_running
  [ -d "$MODS" ] || fail "mods are already off (no $MODS)"
  [ ! -e "$MODS_OFF" ] || fail "$MODS_OFF already exists; look at it first"
  mv -- "$MODS" "$MODS_OFF"
  say "mods are OFF; the next start is a plain server"
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
