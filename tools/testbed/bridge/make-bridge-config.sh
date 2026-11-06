#!/usr/bin/env bash
# Creates the three private files of the bridge, with fresh random secrets, in one step:
#   receiver.json  the receiver's config (both tokens). Root only; the receiver gets a copy
#                  through systemd LoadCredential, so it never owns or edits it.
#   bridge.json    the game plugin's config (the producer token only). Readable by the game user.
#   dev.env        the values that ff-server needs on the dev machine (the query token only).
# The two tokens differ, so the game can never query and ff-server can never write.
# Secrets are written with shell built-ins and never appear in a command line, a log or the
# output. The script refuses to overwrite any of the three files.
# Runs as root on the server. See tools/testbed/bridge-runbook.md.
#
# Usage:  make-bridge-config.sh <session-name>
set -euo pipefail
umask 077

CONF_DIR=${GAFFER_BRIDGE_CONF_DIR:-/etc/gaffer-bridge}
GAME_CONF_DIR=${GAFFER_BRIDGE_GAME_CONF_DIR:-/etc/gaffer-bridge-game}
GAME_OWNER=${GAFFER_GAME_OWNER:-satisfactory:satisfactory}
LISTEN_HOST=${GAFFER_BRIDGE_HOST:-100.71.187.3}
PORT=${GAFFER_BRIDGE_PORT:-9443}
# The name in the game's URL must be the name in the TLS certificate (a DNS SAN).
PUBLIC_NAME=${GAFFER_BRIDGE_NAME:-openclaw-1.tail35a28.ts.net}
# systemd puts LoadCredential files here for the unit gaffer-bridge-receiver.service.
CREDENTIALS_DIR=${GAFFER_RECEIVER_CREDENTIALS_DIR:-/run/credentials/gaffer-bridge-receiver.service}
DATABASE_PATH=${GAFFER_RECEIVER_DATABASE:-/var/lib/gaffer-bridge/receiver.db}

temp=""

fail() {
  echo "make-bridge-config: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$temp" ]; then rm -rf "$temp"; fi
}
trap cleanup EXIT

# 32 bytes of randomness as 64 hex characters: inside the receiver's token rule (32 to 256
# characters of A-Z a-z 0-9 _ -).
new_token() { openssl rand -hex 32; }
# The kernel gives a lowercase version 4 UUID, which is the form that both sides require.
new_uuid() { cat /proc/sys/kernel/random/uuid; }

write_receiver_config() {
  printf '{\n  "host": "%s",\n  "port": %s,\n  "serverId": "%s",\n  "worldId": "%s",\n  "token": "%s",\n  "queryToken": "%s",\n  "databasePath": "%s",\n  "certPath": "%s/server.pem",\n  "keyPath": "%s/server-key.pem"\n}\n' \
    "$LISTEN_HOST" "$PORT" "$server_id" "$world_id" "$token" "$query_token" "$DATABASE_PATH" "$CREDENTIALS_DIR" "$CREDENTIALS_DIR" >"$1"
}

write_game_config() {
  # The plugin accepts exactly these six keys.
  printf '{\n  "enabled": true,\n  "url": "https://%s:%s",\n  "token": "%s",\n  "serverId": "%s",\n  "worldId": "%s",\n  "sessionName": "%s"\n}\n' \
    "$PUBLIC_NAME" "$PORT" "$token" "$server_id" "$world_id" "$session_name" >"$1"
}

write_dev_env() {
  printf 'FOREMAN_BRIDGE_URL=https://%s:%s\nFOREMAN_BRIDGE_QUERY_TOKEN=%s\nFOREMAN_BRIDGE_SERVER_ID=%s\nFOREMAN_BRIDGE_WORLD_ID=%s\n' \
    "$PUBLIC_NAME" "$PORT" "$query_token" "$server_id" "$world_id" >"$1"
}

main() {
  [ "$#" -eq 1 ] || { echo "usage: make-bridge-config.sh <session-name>" >&2; exit 2; }
  session_name=$1
  # Plain characters only, so the name needs no JSON escaping. It must equal the session name
  # that the game saved (the session list of the server shows it).
  [[ "$session_name" =~ ^[A-Za-z0-9._\ -]{1,64}$ ]] || fail "the session name must be 1 to 64 letters, digits, space . _ -"
  for target in "$CONF_DIR/receiver.json" "$CONF_DIR/dev.env" "$GAME_CONF_DIR/bridge.json"; do
    [ ! -e "$target" ] || fail "$target already exists; refusing to overwrite a secret"
  done

  token=$(new_token)
  query_token=$(new_token)
  server_id=$(new_uuid)
  world_id=$(new_uuid)
  [ "$token" != "$query_token" ] || fail "the random generator returned equal tokens"

  # Root-only directory for the receiver's files; a group-readable one for the game's file.
  install -d -m 0700 "$CONF_DIR" "$CONF_DIR/tls"
  install -d -m 0750 "$GAME_CONF_DIR"
  chgrp "${GAME_OWNER#*:}" "$GAME_CONF_DIR"
  temp=$(mktemp -d "$CONF_DIR/.new.XXXXXX")
  write_receiver_config "$temp/receiver.json"
  write_dev_env "$temp/dev.env"
  write_game_config "$temp/bridge.json"
  chown "$GAME_OWNER" "$temp/bridge.json"
  chmod 600 "$temp/receiver.json" "$temp/dev.env" "$temp/bridge.json"
  mv -n "$temp/bridge.json" "$GAME_CONF_DIR/bridge.json"
  mv -n "$temp/receiver.json" "$CONF_DIR/receiver.json"
  mv -n "$temp/dev.env" "$CONF_DIR/dev.env"
  echo "make-bridge-config: wrote $CONF_DIR/receiver.json, $CONF_DIR/dev.env and $GAME_CONF_DIR/bridge.json (mode 0600; the values are not shown)"
}

main "$@"
