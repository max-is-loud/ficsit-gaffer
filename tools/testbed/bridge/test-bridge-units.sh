#!/usr/bin/env bash
# Checks that the systemd units, the game drop-in and the scripts agree with each other: the
# paths and names that one file writes are the ones that another file reads. A mismatch here
# would only show on the server, so this test reads the files and compares. It also runs
# `systemd-analyze verify` when that tool exists. No server is involved.
# Usage:  test-bridge-units.sh   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-bridge-common.sh"

units="$bridge/systemd"
receiver="$units/gaffer-bridge-receiver.service"
renew_service="$units/gaffer-bridge-cert-renew.service"
dropin="$units/satisfactory-bridge.conf"
runbook="$here/bridge-runbook.md"

# default_of <script> <variable> prints the default value of a ${NAME:-default} setting.
default_of() { sed -n "s/.*\${$2:-\([^}]*\)}.*/\1/p" "$bridge/$1" | head -n 1; }

test_receiver_unit() {
  check "the receiver runs as its own user" contains "$receiver" "User=gaffer-bridge"
  check "the receiver reads the config from the credentials directory" contains "$receiver" "--config %d/receiver.json"
  check "the receiver gets all three secrets as credentials" test "$(grep -c '^LoadCredential=' "$receiver")" -eq 3
  check "the credentials come from the root-owned config directory" test "$(grep '^LoadCredential=' "$receiver" | grep -c ':/etc/gaffer-bridge/')" -eq 3
  check "the config script writes the paths that the unit's credentials provide" \
    test "$(default_of make-bridge-config.sh GAFFER_RECEIVER_CREDENTIALS_DIR)" = /run/credentials/gaffer-bridge-receiver.service
  check "the config script writes receiver.json where the unit loads it" \
    test "$(default_of make-bridge-config.sh GAFFER_BRIDGE_CONF_DIR)/receiver.json" = /etc/gaffer-bridge/receiver.json
  check "the renewal script writes where the unit loads the certificate" \
    test "$(default_of renew-bridge-cert.sh GAFFER_TLS_DIR)" = /etc/gaffer-bridge/tls
  check "the state directory matches the database path" \
    test "/var/lib/$(sed -n 's/^StateDirectory=//p' "$receiver")/receiver.db" = "$(default_of make-bridge-config.sh GAFFER_RECEIVER_DATABASE)"
  check "the receiver listens on the tailnet address only (the config default)" test "$(default_of make-bridge-config.sh GAFFER_BRIDGE_HOST)" = 100.71.187.3
  check "the receiver has a memory cap" contains "$receiver" "MemoryMax=256M"
  check "the receiver may only talk to the tailnet and this host" contains "$receiver" "IPAddressAllow=100.64.0.0/10 127.0.0.0/8"
  check "the receiver unit is not run as root" bash -c '! grep -q "^User=root" "$0"' "$receiver"
}

test_renewal_unit() {
  check "the renewal service writes only the TLS directory" contains "$renew_service" "ReadWritePaths=$(default_of renew-bridge-cert.sh GAFFER_TLS_DIR)"
  check "the renewal script restarts the receiver unit by its real name" \
    test "$(default_of renew-bridge-cert.sh GAFFER_RECEIVER_UNIT)" = gaffer-bridge-receiver.service
  check "the timer starts the renewal service" contains "$units/gaffer-bridge-cert-renew.timer" "Unit=gaffer-bridge-cert-renew.service"
}

test_game_dropin() {
  check "the drop-in keeps the unit's ExecStartPre by adding after it (no reset)" bash -c '! grep -q "^ExecStartPre=$" "$0"' "$dropin"
  check "the drop-in resets ExecStart once and sets one line" test "$(grep -c '^ExecStart=' "$dropin")" -eq 2
  check "the new ExecStart keeps the ports of the unit" contains "$dropin" "FactoryServer.sh -Port=7777 -ReliablePort=8888 -ForemanBridgeConfig="
  check "the plugin flag names the file that the config script writes" \
    contains "$dropin" "-ForemanBridgeConfig=$(default_of make-bridge-config.sh GAFFER_BRIDGE_GAME_CONF_DIR)/bridge.json"
  check "the guard script is where the runbook installs it" contains "$dropin" "ExecStartPre=/opt/gaffer-bridge/bin/mods-control.sh guard"
  check "the approval list is where the config script's directory is" \
    test "$(default_of mods-control.sh GAFFER_APPROVED_BUILDS)" = "$(default_of make-bridge-config.sh GAFFER_BRIDGE_GAME_CONF_DIR)/supported-builds"
  check "the receiver is a soft dependency of the game (Wants, never Requires)" bash -c 'grep -q "^Wants=gaffer-bridge-receiver.service" "$0" && ! grep -q "^Requires=" "$0"' "$dropin"
}

test_runbook_mentions_every_file() {
  local file
  for file in "$bridge"/*.sh "$bridge"/packages.sha256 "$units"/*; do
    case "$(basename "$file")" in test-*) continue ;; esac
    check "the runbook names $(basename "$file")" contains "$runbook" "$(basename "$file")"
  done
}

test_systemd_verify() {
  if ! command -v systemd-analyze >/dev/null; then echo "skip systemd-analyze verify: not installed"; return; fi
  # The unit files name binaries and a user that exist only on the server, so only those two
  # messages are expected when the files are checked here.
  local unit output
  for unit in "$receiver" "$renew_service" "$units/gaffer-bridge-cert-renew.timer"; do
    output=$(systemd-analyze verify --man=no "$unit" 2>&1 | grep -vE 'is not executable: No such file or directory|Failed to resolve user' || true)
    check "systemd-analyze verify finds no other problem in $(basename "$unit")" test -z "$output"
  done
}

test_receiver_unit
test_renewal_unit
test_game_dropin
test_runbook_mentions_every_file
test_systemd_verify
echo "all $passed checks passed"
