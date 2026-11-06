#!/usr/bin/env bash
# Tests make-bridge-config.sh and fetch-bridge-env.sh in a temporary directory: file modes,
# random and distinct secrets, lowercase UUIDs, no secret in any output, no overwrite. One test
# starts the real receiver from this repository with the generated config, so a config that the
# receiver would refuse fails here and not on the server. No server is involved.
# Usage:  test-bridge-config.sh   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-bridge-common.sh"

conf="$work/etc/gaffer-bridge"
game="$work/etc/gaffer-bridge-game"
credentials="$work/credentials"
export GAFFER_BRIDGE_CONF_DIR="$conf" GAFFER_BRIDGE_GAME_CONF_DIR="$game" GAFFER_GAME_OWNER="$owner"
export GAFFER_BRIDGE_HOST=127.0.0.1 GAFFER_BRIDGE_NAME=127.0.0.1 GAFFER_BRIDGE_PORT=9443
export GAFFER_RECEIVER_CREDENTIALS_DIR="$credentials" GAFFER_RECEIVER_DATABASE="$work/state/receiver.db"

# No test puts a secret in a command line: these are shell functions (no new process), and
# lacks_secret reads the secret on standard input.
token_ok() { [[ "$1" =~ ^[A-Za-z0-9_-]{32,256}$ ]]; }
uuid_ok() { [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; }

# json_field <file> <key> prints one string value. Python is used because it ships with the server.
json_field() { python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
env_value() { sed -n "s/^$2=//p" "$1"; }

test_generated_files() {
  "$bridge/make-bridge-config.sh" Codex >"$work/output" 2>&1
  local token query_token world server
  token=$(json_field "$conf/receiver.json" token)
  query_token=$(json_field "$conf/receiver.json" queryToken)
  server=$(json_field "$conf/receiver.json" serverId)
  world=$(json_field "$conf/receiver.json" worldId)
  check "the three files are mode 600" test "$(mode_of "$conf/receiver.json")$(mode_of "$conf/dev.env")$(mode_of "$game/bridge.json")" = 600600600
  check "the receiver's directory is private (700)" test "$(mode_of "$conf")" = 700
  check "the game's directory is group-only (750)" test "$(mode_of "$game")" = 750
  check "the producer token follows the receiver's rule (32 to 256 of A-Za-z0-9_-)" token_ok "$token"
  check "the query token follows the receiver's rule" token_ok "$query_token"
  check "the producer token and the query token differ" test "$token" != "$query_token"
  check "the server id is a lowercase UUID" uuid_ok "$server"
  check "the world id is a lowercase UUID" uuid_ok "$world"
  check "the server id and the world id differ" test "$server" != "$world"
  check "the game config has exactly the six keys that the plugin accepts" \
    test "$(python3 -I -c 'import json, sys; print(",".join(sorted(json.load(open(sys.argv[1])))))' "$game/bridge.json")" = enabled,serverId,sessionName,token,url,worldId
  check "the game gets the producer token" test "$(json_field "$game/bridge.json" token)" = "$token"
  check "the game config names the session" test "$(json_field "$game/bridge.json" sessionName)" = Codex
  check "the game URL uses the certificate name" test "$(json_field "$game/bridge.json" url)" = https://127.0.0.1:9443
  check "the game config does not hold the query token" lacks_secret "$game/bridge.json" "$query_token"
  check "dev.env holds the query token" test "$(env_value "$conf/dev.env" FOREMAN_BRIDGE_QUERY_TOKEN)" = "$query_token"
  check "dev.env does not hold the producer token" lacks_secret "$conf/dev.env" "$token"
  check "dev.env carries both ids" test "$(env_value "$conf/dev.env" FOREMAN_BRIDGE_SERVER_ID)/$(env_value "$conf/dev.env" FOREMAN_BRIDGE_WORLD_ID)" = "$server/$world"
  check "the output shows no producer token" lacks_secret "$work/output" "$token"
  check "the output shows no query token" lacks_secret "$work/output" "$query_token"
  check "no temporary directory is left behind" test -z "$(find "$conf" -maxdepth 1 -name '.new.*')"
}

test_refusals() {
  local before
  before=$(sha256sum "$conf/receiver.json" "$conf/dev.env" "$game/bridge.json")
  check "a second run refuses to overwrite the secrets" refuses "$bridge/make-bridge-config.sh" Codex
  check "the secrets are unchanged after the refusal" test "$(sha256sum "$conf/receiver.json" "$conf/dev.env" "$game/bridge.json")" = "$before"
  check "a session name with a quote is refused" refuses env GAFFER_BRIDGE_CONF_DIR="$work/other" GAFFER_BRIDGE_GAME_CONF_DIR="$work/other-game" "$bridge/make-bridge-config.sh" 'a"b'
  check "a refused name creates nothing" test ! -e "$work/other"
}

test_two_runs_differ() {
  GAFFER_BRIDGE_CONF_DIR="$work/second" GAFFER_BRIDGE_GAME_CONF_DIR="$work/second-game" "$bridge/make-bridge-config.sh" Codex >/dev/null
  check "two runs give different tokens" test "$(json_field "$work/second/receiver.json" token)" != "$(json_field "$conf/receiver.json" token)"
}

# The receiver reads its files from the credentials directory, as systemd provides it: mode 400.
test_real_receiver_accepts_config() {
  if ! command -v openssl curl >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
    echo "skip the real-receiver test: it needs Node 24 or later, openssl and curl"
    return
  fi
  local port pki="$work/pki" query_token token
  port=$(python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  rm -rf "$conf" "$game"
  GAFFER_BRIDGE_PORT="$port" "$bridge/make-bridge-config.sh" Codex >/dev/null
  bash "$repo/integrations/foreman-bridge/receiver/scripts/make-test-cert.sh" "$pki" 127.0.0.1 >/dev/null
  mkdir -p "$credentials" "$work/state"
  cp "$conf/receiver.json" "$pki/server.pem" "$pki/server-key.pem" "$credentials/"
  chmod 400 "$credentials"/*
  node "$repo/integrations/foreman-bridge/receiver/src/main.mjs" --config "$credentials/receiver.json" >"$work/receiver.log" 2>&1 &
  writer_pid=$!
  local waited=0
  until curl -sS --cacert "$pki/ca.pem" "https://127.0.0.1:$port/healthz" >"$work/health" 2>/dev/null || [ "$waited" -ge 50 ]; do sleep 0.1; waited=$((waited + 1)); done
  check "the real receiver starts with the generated config" contains "$work/health" '"ready":true'
  query_token=$(env_value "$conf/dev.env" FOREMAN_BRIDGE_QUERY_TOKEN)
  token=$(json_field "$game/bridge.json" token)
  # The bearer header goes to curl on standard input, never as an argument.
  query() { printf 'header = "Authorization: Bearer %s"\n' "$1" | curl -sS --config - --cacert "$pki/ca.pem" -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "https://127.0.0.1:$port/query/v1/constructors"; }
  check "the query token from dev.env is accepted by the query route" test "$(query "$query_token")" = 200
  check "the game's producer token is refused by the query route" test "$(query "$token")" = 401

  # The runbook's own e4 command, with a real curl, against the real receiver.
  local home="$work/e4-home"
  mkdir -p "$home/.config/gaffer"
  cp "$conf/dev.env" "$home/.config/gaffer/bridge.env"
  HOME="$home" CURL_CA_BUNDLE="$pki/ca.pem" bash -c "$(runbook_block '^\*\*e4\.')" </dev/null >"$work/e4.out" 2>&1
  check "the runbook's e4 command gets the receiver's answer" contains "$work/e4.out" '"reason": "no_baseline"'
}

test_fetch_env() {
  local fake="$work/fake-ssh" destination="$work/home/.config/gaffer/bridge.env"
  printf '#!/usr/bin/env bash\ncat "%s"\n' "$conf/dev.env" >"$fake"
  chmod +x "$fake"
  GAFFER_SSH="$fake" "$bridge/fetch-bridge-env.sh" fake-host "$destination" >"$work/fetch-output" 2>&1
  check "fetch writes the file with the same values" cmp -s "$destination" "$conf/dev.env"
  check "the fetched file is mode 600" test "$(mode_of "$destination")" = 600
  check "its directory is mode 700" test "$(mode_of "$(dirname "$destination")")" = 700
  check "fetch output shows no token" lacks_secret "$work/fetch-output" "$(env_value "$conf/dev.env" FOREMAN_BRIDGE_QUERY_TOKEN)"
  check "fetch output shows no world id" lacks_secret "$work/fetch-output" "$(env_value "$conf/dev.env" FOREMAN_BRIDGE_WORLD_ID)"
  check "fetch refuses to overwrite" refuses env GAFFER_SSH="$fake" "$bridge/fetch-bridge-env.sh" fake-host "$destination"

  git init -q "$work/repo"
  check "fetch refuses a path inside a git repository" refuses env GAFFER_SSH="$fake" "$bridge/fetch-bridge-env.sh" fake-host "$work/repo/bridge.env"
  check "that refusal writes nothing" test ! -e "$work/repo/bridge.env"

  printf '#!/usr/bin/env bash\nprintf "FOREMAN_BRIDGE_URL=https://x\\n"\n' >"$work/short-ssh"
  chmod +x "$work/short-ssh"
  check "fetch refuses a file with a missing value" refuses env GAFFER_SSH="$work/short-ssh" "$bridge/fetch-bridge-env.sh" fake-host "$work/short/bridge.env"
  printf '#!/usr/bin/env bash\ncat "%s"; echo EXTRA=1\n' "$conf/dev.env" >"$work/extra-ssh"
  chmod +x "$work/extra-ssh"
  check "fetch refuses a file with an unexpected line" refuses env GAFFER_SSH="$work/extra-ssh" "$bridge/fetch-bridge-env.sh" fake-host "$work/extra/bridge.env"
  check "fetch refuses when ssh fails" refuses env GAFFER_SSH=false "$bridge/fetch-bridge-env.sh" fake-host "$work/failed/bridge.env"
  check "refused fetches leave no file and no temporary file" test -z "$(find "$work/short" "$work/extra" "$work/failed" -type f 2>/dev/null)"
}

test_generated_files
test_refusals
test_two_runs_differ
test_fetch_env
test_real_receiver_accepts_config
echo "all $passed checks passed"
