#!/usr/bin/env bash
# Gets the TLS certificate of the bridge receiver from Tailscale, and installs it only when it
# changed. `tailscale cert` returns the cached certificate while it has more than
# GAFFER_CERT_MIN_VALIDITY left, and issues a new one (Let's Encrypt, 90 days) when it has less.
# Tailscale does not renew a certificate that was written to files, so a weekly timer runs
# this script. The receiver reads its certificate once, at start, so a changed certificate
# restarts it. The new files are checked before they replace the old ones: the host name,
# the expiry date and the match between key and certificate. The old pair stays as *.previous.
# Runs as root on the server (tailscale cert needs it). See tools/testbed/bridge-runbook.md.
#
# Usage:  renew-bridge-cert.sh
set -euo pipefail
umask 077

DOMAIN=${GAFFER_CERT_DOMAIN:-openclaw-1.tail35a28.ts.net}
TLS_DIR=${GAFFER_TLS_DIR:-/etc/gaffer-bridge/tls}
TAILSCALE=${GAFFER_TAILSCALE:-tailscale}
SYSTEMCTL=${GAFFER_SYSTEMCTL:-systemctl}
RECEIVER_UNIT=${GAFFER_RECEIVER_UNIT:-gaffer-bridge-receiver.service}
# 30 days: the weekly run renews with at least three weeks to spare.
MIN_VALIDITY=${GAFFER_CERT_MIN_VALIDITY:-720h}

staging=""

fail() {
  echo "renew-bridge-cert: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$staging" ]; then rm -rf "$staging"; fi
}
trap cleanup EXIT

public_key_of_certificate() { openssl x509 -in "$1" -noout -pubkey; }
public_key_of_key() { openssl pkey -in "$1" -pubout; }

# Never install a pair that the receiver could not use.
check_new_pair() {
  openssl x509 -in "$1/server.pem" -noout -checkend 86400 >/dev/null || fail "the new certificate expires within a day"
  openssl x509 -in "$1/server.pem" -noout -checkhost "$DOMAIN" >/dev/null || fail "the new certificate does not name $DOMAIN"
  [ "$(public_key_of_certificate "$1/server.pem")" = "$(public_key_of_key "$1/server-key.pem")" ] \
    || fail "the new key does not match the new certificate"
}

install_pair() {
  local name
  for name in server.pem server-key.pem; do
    if [ -e "$TLS_DIR/$name" ]; then cp -p -- "$TLS_DIR/$name" "$TLS_DIR/$name.previous"; fi
  done
  chmod 644 "$staging/server.pem"
  chmod 600 "$staging/server-key.pem"
  mv -- "$staging/server-key.pem" "$TLS_DIR/server-key.pem"
  mv -- "$staging/server.pem" "$TLS_DIR/server.pem"
}

restart_receiver() {
  if "$SYSTEMCTL" is-active --quiet "$RECEIVER_UNIT"; then
    "$SYSTEMCTL" restart "$RECEIVER_UNIT"
    "$SYSTEMCTL" is-active --quiet "$RECEIVER_UNIT" || fail "$RECEIVER_UNIT did not restart; the old pair is in $TLS_DIR/*.previous"
    echo "renew-bridge-cert: restarted $RECEIVER_UNIT with the new certificate"
  else
    echo "renew-bridge-cert: $RECEIVER_UNIT is not running; it will use the new certificate when it starts"
  fi
}

main() {
  [ -d "$TLS_DIR" ] || fail "$TLS_DIR does not exist (run make-bridge-config.sh first)"
  staging=$(mktemp -d "$TLS_DIR/.staging.XXXXXX")
  "$TAILSCALE" cert --min-validity "$MIN_VALIDITY" --cert-file "$staging/server.pem" --key-file "$staging/server-key.pem" "$DOMAIN"
  check_new_pair "$staging"
  if cmp -s "$staging/server.pem" "$TLS_DIR/server.pem" 2>/dev/null && cmp -s "$staging/server-key.pem" "$TLS_DIR/server-key.pem" 2>/dev/null; then
    echo "renew-bridge-cert: the installed certificate is current; nothing changed"
    return
  fi
  install_pair
  echo "renew-bridge-cert: installed a certificate that expires $(openssl x509 -in "$TLS_DIR/server.pem" -noout -enddate | cut -d= -f2)"
  restart_receiver
}

main "$@"
