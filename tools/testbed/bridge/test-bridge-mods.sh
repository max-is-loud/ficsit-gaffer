#!/usr/bin/env bash
# Tests mods-control.sh with a fake game directory, a fake Steam manifest and a fake
# `systemctl` in a temporary directory: the guard on an unapproved build, the fail-closed
# rule, and the on and off commands. No server and no game are involved.
# Usage:  test-bridge-mods.sh   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-bridge-common.sh"

game="$work/server"
approved="$work/supported-builds"
export GAFFER_GAME_DIR="$game" GAFFER_APPROVED_BUILDS="$approved" GAFFER_SYSTEMCTL="$work/systemctl"
control() { "$bridge/mods-control.sh" "$@"; }

# The fake systemctl: "is-active" is true while the file "running" exists.
printf '#!/usr/bin/env bash\n[ "$1" = is-active ] && [ -e "%s/running" ]\n' "$work" >"$work/systemctl"
chmod +x "$work/systemctl"

# fresh_game <build-id> sets up a game directory with mods installed and a Steam manifest.
fresh_game() {
  rm -rf "$game"
  mkdir -p "$game/FactoryGame/Mods/SML" "$game/steamapps"
  touch "$game/FactoryGame/Mods/SML/SML.uplugin"
  if [ -n "${1:-}" ]; then
    # The real manifest indents with tabs and holds "buildid" next to "TargetBuildID".
    printf '"AppState"\n{\n\t"appid"\t\t"1690800"\n\t"buildid"\t\t"%s"\n\t"TargetBuildID"\t\t"%s"\n}\n' "$1" "$1" >"$game/steamapps/appmanifest_1690800.acf"
  fi
  rm -f "$work/running"
}

mods_on() { [ -d "$game/FactoryGame/Mods/SML" ]; }
mods_off() { [ -d "$game/FactoryGame/Mods.off/SML" ] && [ ! -e "$game/FactoryGame/Mods" ]; }

test_guard() {
  printf '# builds that SML and the bridge support\n25782485  # tested 5 Nov\n\n  25782999\n' >"$approved"
  fresh_game 25782485
  control guard >"$work/out" 2>&1
  check "guard keeps mods on an approved build" mods_on
  check "guard says why" contains "$work/out" "is approved"
  fresh_game 25782999
  control guard >/dev/null 2>&1
  check "guard accepts a build on the second approved line" mods_on

  fresh_game 25782486
  check "guard exits 0 on an unapproved build, so the game still starts" quietly control guard
  check "guard moves mods away on an unapproved build" mods_off
  fresh_game 25782486
  control guard >"$work/out" 2>&1
  check "guard tells the journal that the server starts without mods" contains "$work/out" "WITHOUT mods"

  fresh_game 2578248
  control guard >/dev/null 2>&1
  check "a build that is a prefix of an approved one is not approved" mods_off
  fresh_game 257824850
  control guard >/dev/null 2>&1
  check "a build that extends an approved one is not approved" mods_off

  fresh_game ""
  control guard >/dev/null 2>&1
  check "guard treats a missing manifest as an unknown build" mods_off
  fresh_game 25782485
  rm "$approved"
  control guard >/dev/null 2>&1
  check "guard treats a missing approval list as no approval" mods_off
  printf '25782485\n' >"$approved"
}

test_guard_edges() {
  fresh_game 25782486
  rm -r "$game/FactoryGame/Mods"
  check "guard does nothing when there is no Mods directory" quietly control guard

  # R1-02: with no Mods folder the guard exits 0 whatever else fails.
  if [ "$(id -u)" -ne 0 ]; then
    fresh_game 25782486
    rm -r "$game/FactoryGame/Mods"
    chmod 000 "$game/steamapps/appmanifest_1690800.acf"
    check "no Mods + unreadable manifest: guard exits 0" quietly control guard
    chmod 644 "$game/steamapps/appmanifest_1690800.acf"
    chmod 000 "$approved"
    check "no Mods + unreadable approval list: guard exits 0" quietly control guard
    chmod 644 "$approved"
  else
    echo "skip the unreadable-file tests: they need a user that is not root"
  fi
  fresh_game 25782486
  rm -r "$game/FactoryGame/Mods" "$game/steamapps"
  check "no Mods + no manifest: guard exits 0" quietly control guard
  check "no Mods + no game directory at all: guard exits 0" quietly env GAFFER_GAME_DIR="$work/missing" "$bridge/mods-control.sh" guard

  fresh_game 25782486
  mkdir "$game/FactoryGame/Mods.off"
  control guard >/dev/null 2>&1
  check "guard never overwrites an existing Mods.off" test "$(find "$game/FactoryGame" -maxdepth 1 -name 'Mods.off-*' | wc -l)" -eq 1
  check "the old Mods.off is untouched" test -d "$game/FactoryGame/Mods.off"
  check "the mods moved to the stamped folder, not into Mods.off" test ! -e "$game/FactoryGame/Mods.off/Mods"

  if [ "$(id -u)" -ne 0 ]; then
    # The one case in which the guard stops the game: mods present, build unapproved, move fails.
    fresh_game 25782486
    chmod 555 "$game/FactoryGame"
    local status=0
    control guard >"$work/out" 2>&1 || status=$?
    chmod 755 "$game/FactoryGame"
    check "unapproved build + rename fails: guard exits non-zero" test "$status" -ne 0
    check "the refusal is one clear journal line" test "$(grep -c 'REFUSING TO START THE GAME' "$work/out")" -eq 1
    check "mods stay where they were after that failure" mods_on
    fresh_game ""
    chmod 555 "$game/FactoryGame"
    status=0
    control guard >/dev/null 2>&1 || status=$?
    chmod 755 "$game/FactoryGame"
    check "unreadable manifest + rename fails: guard exits non-zero" test "$status" -ne 0
    fresh_game 25782485
    chmod 555 "$game/FactoryGame"
    check "approved build: guard exits 0 even when the folder is read-only" quietly control guard
    chmod 755 "$game/FactoryGame"
    check "approved build: mods are left on" mods_on
  else
    echo "skip the fail-closed tests: they need a user that is not root"
  fi
}

test_on_and_off() {
  fresh_game 25782485
  touch "$work/running"
  check "off refuses while the game runs" refuses control off
  rm "$work/running"
  control off >/dev/null
  check "off moves mods away" mods_off
  # R1-03: off is idempotent, so the rollback can always start the game again.
  check "off succeeds when mods are already off" quietly control off
  check "a repeated off leaves mods off" mods_off
  fresh_game 25782485
  rm -r "$game/FactoryGame/Mods"
  check "off succeeds when there never were mods" quietly control off
  fresh_game 25782485
  mkdir "$game/FactoryGame/Mods.off"
  check "off succeeds when Mods and Mods.off both exist" quietly control off
  check "off then moves Mods to a stamped folder" test "$(find "$game/FactoryGame" -maxdepth 1 -name 'Mods.off-*' | wc -l)" -eq 1
  check "off leaves no Mods folder" test ! -e "$game/FactoryGame/Mods"

  fresh_game 25782485
  control off >/dev/null
  touch "$work/running"
  check "on refuses while the game runs" refuses control on
  rm "$work/running"
  control on >/dev/null
  check "on restores the mods on an approved build" mods_on
  control off >/dev/null
  printf '25782999\n' >"$approved"
  check "on refuses a build that is not approved" refuses control on
  check "that refusal leaves mods off" mods_off
  printf '25782485\n' >"$approved"
  mkdir "$game/FactoryGame/Mods"
  check "on refuses when a Mods directory exists" refuses control on
}

test_status() {
  fresh_game 25782485
  control status >"$work/out"
  check "status shows the build, the approval and the state" bash -c 'grep -q "25782485" "$0" && grep -q "is approved" "$0" && grep -q "mods are ON" "$0"' "$work/out"
}

test_guard
test_guard_edges
test_on_and_off
test_status
echo "all $passed checks passed"
