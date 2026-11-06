#!/usr/bin/env bash
# Runs the runbook's own commands (R1, R2, X and e4) against a fake server in a temporary
# directory. A fake `ssh` runs the command on this machine after it rewrites the server paths to
# the fake tree, a fake `sudo` drops its options, and a fake `systemctl` keeps the state of the
# game and of the units. The fake `systemctl` copies the real exit codes that matter here: a
# missing unit makes `disable` fail with 1. When the drop-in exists, a fake `start` runs the real
# guard first, as systemd runs the ExecStartPre. No server is involved. This cannot prove
# anything about systemd on the server itself.
# Usage:  test-bridge-runbook.sh   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-bridge-common.sh"

root="$work/server-root"
state="$work/state"
bin="$work/bin"
fg="$root/server/FactoryGame"
units="$root/etc/systemd/system"
dropin="$units/satisfactory.service.d/bridge.conf"
mkdir -p "$bin" "$state"

export FAKE_ROOT="$root" FAKE_STATE="$state" FAKE_BRIDGE_DIR="$bridge"
export GAFFER_GAME_DIR="$root/server" GAFFER_APPROVED_BUILDS="$root/etc/gaffer-bridge-game/supported-builds" GAFFER_SYSTEMCTL="$bin/systemctl"
export PATH="$bin:$PATH"

cat >"$bin/ssh" <<'FAKE'
#!/usr/bin/env bash
shift
cmd=$*
# Two passes through placeholders, so a rewritten path is never rewritten again.
subst() {
  sed -e 's|/opt/gaffer-bridge/bin|@BIN@|g' -e 's|/opt/gaffer-bridge|@OPT@|g' -e 's|/home/satisfactory/server|@SERVER@|g' \
    -e 's|/etc/systemd/system|@UNITS@|g' -e 's|/etc/gaffer-bridge-game|@GAME@|g' -e 's|/etc/gaffer-bridge|@ETC@|g' \
    -e 's|/var/lib/gaffer-bridge|@VAR@|g' -e 's|/tmp/gaffer-bridge-stage|@STAGE@|g' |
  sed -e "s|@BIN@|$FAKE_BRIDGE_DIR|g" -e "s|@OPT@|$FAKE_ROOT/opt/gaffer-bridge|g" -e "s|@SERVER@|$FAKE_ROOT/server|g" \
    -e "s|@UNITS@|$FAKE_ROOT/etc/systemd/system|g" -e "s|@GAME@|$FAKE_ROOT/etc/gaffer-bridge-game|g" -e "s|@ETC@|$FAKE_ROOT/etc/gaffer-bridge|g" \
    -e "s|@VAR@|$FAKE_ROOT/var/lib/gaffer-bridge|g" -e "s|@STAGE@|$FAKE_ROOT/tmp/gaffer-bridge-stage|g"
}
if [[ $cmd == *"bash -s"* ]]; then subst | bash -c "$(printf '%s' "$cmd" | subst)"; else bash -c "$(printf '%s' "$cmd" | subst)"; fi
FAKE
cat >"$bin/sudo" <<'FAKE'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  case "$1" in -n) shift ;; -u) shift 2 ;; *) break ;; esac
done
exec "$@"
FAKE
cat >"$bin/getent" <<'FAKE'
#!/usr/bin/env bash
[ "$1" = passwd ] && [ -e "$FAKE_STATE/user" ]
FAKE
cat >"$bin/userdel" <<'FAKE'
#!/usr/bin/env bash
echo "userdel $*" >>"$FAKE_STATE/calls"
rm -f "$FAKE_STATE/user"
FAKE
cat >"$bin/systemctl" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_STATE/calls"
units="$FAKE_ROOT/etc/systemd/system"
cmd=$1
shift
args=()
for arg in "$@"; do case "$arg" in --*) ;; *) args+=("$arg") ;; esac; done
case "$cmd" in
  is-active) [ -e "$FAKE_STATE/active.${args[0]}" ] ;;
  stop) rm -f "$FAKE_STATE/active.${args[0]}" ;;
  start)
    if [ "${args[0]}" = satisfactory.service ] && [ -e "$units/satisfactory.service.d/bridge.conf" ]; then
      "$FAKE_BRIDGE_DIR/mods-control.sh" guard >/dev/null 2>&1 || exit 1
    fi
    touch "$FAKE_STATE/active.${args[0]}"
    ;;
  disable)
    status=0
    for unit in "${args[@]}"; do
      if [ -e "$units/$unit" ]; then
        rm -f "$FAKE_STATE/enabled.$unit" "$FAKE_STATE/active.$unit"
      else
        echo "Failed to disable unit: Unit file $unit does not exist." >&2
        status=1
      fi
    done
    exit $status
    ;;
  *) ;;
esac
FAKE
chmod +x "$bin"/*

game_running() { [ -e "$state/active.satisfactory.service" ]; }
calls() { cat "$state/calls" 2>/dev/null || true; }
# stop_before_start is true when the call log has "stop" and then "start" of the game.
stop_before_start() { calls | awk '/^stop satisfactory.service/ { stopped = NR } /^start satisfactory.service/ { if (stopped) ok = 1 } END { exit !ok }'; }
mods_names() { find "$fg" -maxdepth 1 -name 'Mods*' -printf '%f\n' | sort | tr '\n' ' '; }
run_runbook() { bash -c "$(runbook_block "$1")"; }

# reset <build-id> starts a fresh fake server: the game runs, nothing of the bridge is installed.
reset() {
  rm -rf "$root" "$state"
  mkdir -p "$fg/Content" "$root/server/steamapps" "$units" "$state"
  touch "$fg/Content/keep" "$state/active.satisfactory.service"
  printf '"AppState"\n{\n\t"buildid"\t\t"%s"\n}\n' "${1:-25782485}" >"$root/server/steamapps/appmanifest_1690800.acf"
}

# install_to <step> builds the state of a half-finished install, cumulatively, up to that step.
install_to() {
  local step=$1 order=(b1 b2 b3 b4 b5 b6 b7a b7b b7c) name
  for name in "${order[@]}"; do
    case "$name" in
      b1) mkdir -p "$root/tmp/gaffer-bridge-stage" ;;
      b2) mkdir -p "$root/opt/gaffer-bridge/bin"
          touch "$units/gaffer-bridge-receiver.service" "$units/gaffer-bridge-cert-renew.service" "$units/gaffer-bridge-cert-renew.timer" "$state/user" ;;
      b3) mkdir -p "$root/etc/gaffer-bridge/tls" "$root/etc/gaffer-bridge-game" "$root/var/lib/gaffer-bridge"
          touch "$root/etc/gaffer-bridge/receiver.json" "$root/etc/gaffer-bridge-game/bridge.json" ;;
      b4) touch "$root/etc/gaffer-bridge/tls/server.pem" ;;
      b5) touch "$state/enabled.gaffer-bridge-receiver.service" "$state/active.gaffer-bridge-receiver.service" ;;
      b6) touch "$state/enabled.gaffer-bridge-cert-renew.timer" ;;
      b7a) mkdir -p "$fg/Mods/SML" ;;
      b7b) mkdir -p "$fg/Mods/ForemanBridge"
           printf '25782485\n' >"$root/etc/gaffer-bridge-game/supported-builds" ;;
      b7c) mkdir -p "$units/satisfactory.service.d"
           cp "$bridge/systemd/satisfactory-bridge.conf" "$dropin" ;;
    esac
    [ "$name" != "$step" ] || return 0
  done
}

test_e4_token_not_in_argv() {
  local home="$work/e4-home" token=FAKETOKEN0123456789abcdefghijklmnopqrstuv
  mkdir -p "$home/.config/gaffer"
  printf 'FOREMAN_BRIDGE_URL=https://fake.example:9443\nFOREMAN_BRIDGE_QUERY_TOKEN=%s\nFOREMAN_BRIDGE_SERVER_ID=s\nFOREMAN_BRIDGE_WORLD_ID=w\n' "$token" >"$home/.config/gaffer/bridge.env"
  cat >"$bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$FAKE_STATE/curl.argv"
cat >"$FAKE_STATE/curl.stdin"
env >"$FAKE_STATE/curl.env"
echo '{}'
FAKE
  chmod +x "$bin/curl"
  HOME="$home" run_runbook '^\*\*e4\.' </dev/null >/dev/null
  check "e4: the token is not in curl's arguments" lacks_secret "$state/curl.argv" "$token"
  check "e4: curl reads its options from standard input" grep -qx -e '--config' "$state/curl.argv"
  check "e4: the Authorization header reaches curl on standard input" has_secret "$state/curl.stdin" "Authorization: Bearer $token"
  check "e4: the token is not in curl's environment" bash -c '! grep -q "FOREMAN_BRIDGE_QUERY_TOKEN" "$0"' "$state/curl.env"
  check "e4: the URL comes from the file" grep -qx 'https://fake.example:9443/query/v1/constructors' "$state/curl.argv"
  rm "$bin/curl"
  check "no runbook line puts a bearer token in an option" test "$(grep -c 'Bearer' "$runbook")" -eq "$(grep 'Bearer' "$runbook" | grep -c 'header = ')"
  check "no runbook line uses -H with Authorization" bash -c '! grep -qE -- "-H +[\"'\''](Authorization|authorization)" "$0"' "$runbook"
}

test_r1_every_state() {
  local label
  for label in on off both none; do
    reset
    mkdir -p "$fg/Mods/SML" "$root/etc/gaffer-bridge-game" "$units/satisfactory.service.d"
    printf '25782485\n' >"$root/etc/gaffer-bridge-game/supported-builds"
    cp "$bridge/systemd/satisfactory-bridge.conf" "$dropin"
    case "$label" in
      off) mv "$fg/Mods" "$fg/Mods.off" ;;
      both) mkdir -p "$fg/Mods.off/SML" ;;
      none) rm -r "$fg/Mods" ;;
    esac
    check "R1 (mods $label): the command succeeds" quietly run_runbook '^## R1:'
    check "R1 (mods $label): the game runs again" game_running
    check "R1 (mods $label): the game stopped before it started" stop_before_start
    check "R1 (mods $label): no Mods folder is left to load" test ! -e "$fg/Mods"
  done
}

test_r2_every_partial_install() {
  local step
  for step in b0 b1 b2 b3 b4 b5 b6 b7a b7b b7c; do
    reset
    if [ "$step" != b0 ]; then install_to "$step"; fi
    check "R2 after $step: the script succeeds" quietly run_runbook '^## R2:'
    check "R2 after $step: the game runs" game_running
    check "R2 after $step: no drop-in is left" test ! -e "$dropin"
    check "R2 after $step: no Mods folder is left beside Mods.removed-*" test -z "$(find "$fg" -maxdepth 1 -name 'Mods*' ! -name 'Mods.removed-*')"
    check "R2 after $step: the receiver and the timer are off" test -z "$(ls "$state" | grep -E '^(enabled|active)\.gaffer-bridge' || true)"
    check "R2 after $step: the game folder keeps its other files" test -e "$fg/Content/keep"
    case "$step" in
      b7a|b7b|b7c) check "R2 after $step: the game stopped and started" stop_before_start ;;
      *) check "R2 after $step: the game was not stopped (nothing in the game to roll back)" bash -c '! grep -q "^stop satisfactory" "$0"' "$state/calls" ;;
    esac
    check "R2 after $step: a second run also succeeds" quietly run_runbook '^## R2:'
  done
}

# The guard and mods-control can make Mods.off and Mods.off-<stamp>. This builds them with the real scripts.
make_every_name() {
  local guard=("$bridge/mods-control.sh" guard)
  reset 25782486
  install_to b7c
  mkdir -p "$fg/Mods/SML"
  "${guard[@]}" >/dev/null 2>&1
  mkdir -p "$fg/Mods/SML"
  sleep 1.1
  "${guard[@]}" >/dev/null 2>&1
  mkdir -p "$fg/Mods/SML"
  sleep 1.1
  "${guard[@]}" >/dev/null 2>&1
  mkdir -p "$fg/Mods/SML"
}

test_every_folder_name() {
  make_every_name
  check "the real scripts made Mods, Mods.off and two stamped folders" test "$(mods_names)" = "$(printf 'Mods Mods.off Mods.off-%s Mods.off-%s ' $(find "$fg" -maxdepth 1 -name 'Mods.off-*' -printf '%f\n' | sort | sed 's/^Mods.off-//'))"
  check "X refuses while the drop-in and Mods exist" refuses run_runbook '^## X:'
  check "that refusal deletes nothing" test -d "$root/opt/gaffer-bridge"
  check "R2 succeeds with every folder name present" quietly run_runbook '^## R2:'
  check "R2 leaves only the Mods.removed-* folder" test "$(mods_names | wc -w)" -eq 1
  check "R2 keeps all four folders inside it" test "$(find "$fg"/Mods.removed-* -mindepth 1 -maxdepth 1 | wc -l)" -eq 4
  check "R2 moved each folder as a folder, not into another" test -d "$fg"/Mods.removed-*/Mods/SML
  check "X succeeds" quietly run_runbook '^## X:'
  check "X leaves no Mods* folder at all" test -z "$(mods_names)"
  check "X deletes the bridge files" test ! -e "$root/opt/gaffer-bridge" -a ! -e "$root/etc/gaffer-bridge" -a ! -e "$root/etc/gaffer-bridge-game" -a ! -e "$root/var/lib/gaffer-bridge"
  check "X deletes the unit files" test -z "$(find "$units" -name 'gaffer-bridge-*')"
  check "X removes the receiver user" bash -c 'grep -q "^userdel gaffer-bridge" "$0"' "$state/calls"
  check "X keeps the game's other files" test -e "$fg/Content/keep"
}

test_x_after_partial_install() {
  local step
  for step in b0 b1 b2 b3 b5 b7b; do
    reset
    if [ "$step" != b0 ]; then install_to "$step"; fi
    run_runbook '^## R2:' >/dev/null 2>&1
    check "X after $step and R2: the script succeeds" quietly run_runbook '^## X:'
    check "X after $step and R2: nothing of the bridge is left" test -z "$(find "$root/opt" "$root/etc/gaffer-bridge" "$root/etc/gaffer-bridge-game" "$root/tmp" "$fg" -name 'gaffer-bridge*' -o -name 'Mods*' 2>/dev/null)"
  done
}

test_r2_move_failure_keeps_game_stopped() {
  if [ "$(id -u)" -eq 0 ]; then echo "skip the move-failure test: it needs a user that is not root"; return; fi
  reset
  install_to b7c
  chmod 555 "$fg"
  local status=0
  run_runbook '^## R2:' >"$work/r2.out" 2>&1 || status=$?
  chmod 755 "$fg"
  check "R2: a folder that cannot move makes the script fail" test "$status" -ne 0
  check "R2: the game stays stopped, because starting would load the mods" bash -c '! [ -e "$0/active.satisfactory.service" ]' "$state"
  check "R2: the script says why" grep -q 'the game stays stopped' "$work/r2.out"
}

test_e4_token_not_in_argv
test_r1_every_state
test_r2_every_partial_install
test_every_folder_name
test_x_after_partial_install
test_r2_move_failure_keeps_game_stopped
echo "all $passed checks passed"
