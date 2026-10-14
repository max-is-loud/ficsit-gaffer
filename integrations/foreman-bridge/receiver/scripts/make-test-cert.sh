#!/usr/bin/env bash
set -euo pipefail
umask 077
if [ "$#" -ne 2 ] || [[ "$1" != /* ]] || [[ ! "$2" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo 'usage: make-test-cert.sh /absolute/private/directory hostname-or-IPv4' >&2; exit 2
fi
cert_dir=$1
endpoint=$2
mkdir -p "$cert_dir"
for name in ca-key.pem ca.pem server-key.pem server.pem server.csr server.ext; do
  if [ -e "$cert_dir/$name" ]; then echo 'Refusing to overwrite certificate material' >&2; exit 1; fi
done
if [[ "$endpoint" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then san="IP:$endpoint"; else san="DNS:$endpoint"; fi
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 -keyout "$cert_dir/ca-key.pem" -out "$cert_dir/ca.pem" -subj '/CN=Foreman Bridge Disposable Test CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 -keyout "$cert_dir/server-key.pem" -out "$cert_dir/server.csr" -subj "/CN=$endpoint" >/dev/null 2>&1
cat > "$cert_dir/server.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EXT
openssl x509 -req -in "$cert_dir/server.csr" -CA "$cert_dir/ca.pem" -CAkey "$cert_dir/ca-key.pem" -set_serial "0x$(openssl rand -hex 16)" -out "$cert_dir/server.pem" -days 7 -sha256 -extfile "$cert_dir/server.ext" >/dev/null 2>&1
openssl verify -CAfile "$cert_dir/ca.pem" "$cert_dir/server.pem" >/dev/null
rm "$cert_dir/server.csr" "$cert_dir/server.ext"
echo 'Created disposable CA and server certificate; verification passed.'
