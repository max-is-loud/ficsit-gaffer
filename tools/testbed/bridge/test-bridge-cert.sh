#!/usr/bin/env bash
# Tests renew-bridge-cert.sh with a fake `tailscale` and a fake `systemctl` in a temporary
# directory: first install, no change, renewal, and every refusal (wrong name, near expiry, key
# that does not match, failing tailscale, failing restart). No server and no Tailscale involved.
# Usage:  test-bridge-cert.sh   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-bridge-common.sh"

if ! command -v openssl >/dev/null; then echo "skip: openssl is not installed"; exit 0; fi

domain=receiver-test.example.ts.net
tls="$work/etc/tls"
fake="$work/fake"
mkdir -p "$tls" "$fake"
export GAFFER_CERT_DOMAIN="$domain" GAFFER_TLS_DIR="$tls"
export GAFFER_TAILSCALE="$fake/tailscale" GAFFER_SYSTEMCTL="$fake/systemctl"

# new_pair <name> <host> <days> [key-name] makes a certificate (ECDSA P-256, like Tailscale's).
new_pair() {
  local name=$1 host=$2 days=$3 key=${4:-$1}
  [ -f "$fake/$key.key" ] || openssl ecparam -name prime256v1 -genkey -noout -out "$fake/$key.key" 2>/dev/null
  openssl req -x509 -new -key "$fake/$key.key" -days "$days" -subj "/CN=$host" -addext "subjectAltName=DNS:$host" -out "$fake/$name.crt" 2>/dev/null
}

# The fake tailscale copies the pair named in "offer" to the paths of --cert-file and --key-file.
cat >"$fake/tailscale" <<'FAKE'
#!/usr/bin/env bash
here=$(dirname "$0")
[ "$1" = cert ] || exit 64
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --cert-file) cert=$2; shift 2 ;;
    --key-file) key=$2; shift 2 ;;
    --min-validity) shift 2 ;;
    *) shift ;;
  esac
done
[ ! -e "$here/tailscale-fails" ] || exit 1
offer=$(cat "$here/offer")
cp "$here/${offer%%:*}.crt" "$cert"
cp "$here/${offer##*:}.key" "$key"
FAKE
# The fake systemctl logs each call. "is-active" is true while the file "active" exists. With the
# file "restart-breaks", a restart leaves the receiver down: it creates "down", which wins.
cat >"$fake/systemctl" <<'FAKE'
#!/usr/bin/env bash
here=$(dirname "$0")
echo "$*" >>"$here/calls"
case "$1" in
  is-active) [ -e "$here/active" ] && [ ! -e "$here/down" ] ;;
  restart) if [ -e "$here/restart-breaks" ]; then touch "$here/down"; fi ;;
esac
FAKE
chmod +x "$fake/tailscale" "$fake/systemctl"

offer() { echo "$1:${2:-$1}" >"$fake/offer"; }
restarts() { { grep -c '^restart' "$fake/calls" 2>/dev/null || true; } | head -n 1; }
renew() { "$bridge/renew-bridge-cert.sh"; }
# refused_with <message> succeeds when a run fails and its error output holds the message.
refused_with() {
  local status=0
  renew >"$work/refusal" 2>&1 || status=$?
  [ "$status" -ne 0 ] && contains "$work/refusal" "$1"
}

test_first_install_and_restart() {
  new_pair first "$domain" 90
  offer first
  touch "$fake/active"
  renew >"$work/out" 2>&1
  check "the first run installs the certificate (644)" test "$(mode_of "$tls/server.pem")" = 644
  check "the first run installs the key (600)" test "$(mode_of "$tls/server-key.pem")" = 600
  check "the installed pair is the offered pair" cmp -s "$tls/server.pem" "$fake/first.crt"
  check "a running receiver is restarted" test "$(restarts)" -eq 1
  check "no staging directory is left behind" test -z "$(find "$tls" -maxdepth 1 -name '.staging.*')"
  check "the first run keeps no .previous file" test ! -e "$tls/server.pem.previous"
}

test_no_change() {
  renew >"$work/out" 2>&1
  check "an unchanged certificate causes no restart" test "$(restarts)" -eq 1
  check "an unchanged run says so" contains "$work/out" "nothing changed"
}

test_renewal_keeps_previous() {
  new_pair second "$domain" 90 first
  offer second first
  renew >"$work/out" 2>&1
  check "a renewed certificate is installed" cmp -s "$tls/server.pem" "$fake/second.crt"
  check "the old certificate is kept as .previous" cmp -s "$tls/server.pem.previous" "$fake/first.crt"
  check "the kept key stays mode 600" test "$(mode_of "$tls/server-key.pem.previous")" = 600
  check "a renewal restarts the receiver again" test "$(restarts)" -eq 2
}

test_refusals() {
  local before
  before=$(sha256sum "$tls/server.pem" "$tls/server-key.pem")
  new_pair wrong other.example.ts.net 90
  offer wrong
  check "a certificate for another name is refused" refused_with "does not name $domain"
  new_pair short "$domain" 1
  offer short
  check "a certificate that expires within a day is refused" refused_with "expires within a day"
  new_pair mismatch "$domain" 90 first
  new_pair stranger "$domain" 90
  offer mismatch stranger
  check "a key that does not match the certificate is refused" refused_with "does not match the new certificate"
  offer second first
  touch "$fake/tailscale-fails"
  check "a failing tailscale fails the run" refuses renew
  rm "$fake/tailscale-fails"
  check "no refusal changed the installed pair" test "$(sha256sum "$tls/server.pem" "$tls/server-key.pem")" = "$before"
  check "no refusal left a staging directory" test -z "$(find "$tls" -maxdepth 1 -name '.staging.*')"
}

test_receiver_states() {
  rm "$fake/active"
  new_pair third "$domain" 90 first
  offer third first
  renew >"$work/out" 2>&1
  check "a stopped receiver is not started by a renewal" test "$(restarts)" -eq 2
  check "the new certificate is installed anyway" cmp -s "$tls/server.pem" "$fake/third.crt"
  touch "$fake/active" "$fake/restart-breaks"
  new_pair fourth "$domain" 90 first
  offer fourth first
  local status=0
  renew >"$work/out" 2>&1 || status=$?
  check "a receiver that does not come back fails the run" test "$status" -ne 0
  check "the failure message points to the old pair" contains "$work/out" "*.previous"
  check "the old pair is kept for the manual rollback" test -e "$tls/server.pem.previous"
}

test_first_install_and_restart
test_no_change
test_renewal_keeps_previous
test_refusals
test_receiver_states
echo "all $passed checks passed"
