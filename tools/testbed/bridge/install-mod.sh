#!/usr/bin/env bash
# Installs one SML mod package (a .zip with the plugin at its root) into a Mods directory.
# The package must match its SHA-256 in packages.sha256, so a changed or wrong file never
# reaches the game. The script hashes a private copy (nobody can swap the file in /tmp after
# the check), checks every entry name, unpacks into a staging directory inside the Mods
# directory, and moves the finished folder into place with one rename. It never replaces an
# existing mod folder: the rollback in bridge-runbook.md removes the old one first.
# Runs as root on the server, because it sets the owner of the files.
#
# Usage:  install-mod.sh <package.zip> <mods-directory>
set -euo pipefail
umask 077

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PINS=${GAFFER_PACKAGE_PINS:-$HERE/packages.sha256}
OWNER=${GAFFER_MOD_OWNER:-satisfactory:satisfactory}
# 400 MB is far above both real packages (about 30 MB unpacked). It stops a zip bomb.
MAX_UNPACKED_BYTES=${GAFFER_MAX_UNPACKED_BYTES:-419430400}

staging=""

fail() {
  echo "install-mod: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$staging" ]; then rm -rf "$staging"; fi
}
trap cleanup EXIT

expected_hash() {
  local name hashes
  name=$(basename "$1")
  hashes=$(awk -v name="$name" '$2 == name { print $1 }' "$PINS")
  [ -n "$hashes" ] || fail "$name is not listed in $PINS"
  [ "$(printf '%s\n' "$hashes" | wc -l)" -eq 1 ] || fail "$name is listed more than once in $PINS"
  printf '%s\n' "$hashes"
}

# Reject a name that can write outside the folder, and any symbolic link. Then unpack.
unpack_safely() {
  python3 -I - "$1" "$2" "$MAX_UNPACKED_BYTES" <<'PY'
import stat, sys, zipfile

archive, destination, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
with zipfile.ZipFile(archive) as package:
    total = 0
    for entry in package.infolist():
        parts = entry.filename.split("/")
        if entry.filename.startswith("/") or "\\" in entry.filename or ".." in parts:
            sys.exit(f"unsafe entry name: {entry.filename}")
        if stat.S_ISLNK(entry.external_attr >> 16):
            sys.exit(f"symbolic link in package: {entry.filename}")
        total += entry.file_size
    if total > limit:
        sys.exit("package unpacks to more than the allowed size")
    package.extractall(destination)
PY
}

main() {
  [ "$#" -eq 2 ] || { echo "usage: install-mod.sh <package.zip> <mods-directory>" >&2; exit 2; }
  local package=$1 mods=$2 expected actual plugins name
  [ -f "$package" ] || fail "package not found: $package"
  expected=$(expected_hash "$package")

  # A new Mods directory must be readable by the game user, whatever the umask is.
  if [ ! -d "$mods" ]; then
    install -d -m 0755 "$mods"
    chown "$OWNER" "$mods"
  fi
  staging=$(mktemp -d "$mods/.staging.XXXXXX")
  cp -- "$package" "$staging/package.zip"
  actual=$(sha256sum "$staging/package.zip" | cut -d' ' -f1)
  [ "$actual" = "$expected" ] || fail "SHA-256 mismatch for $(basename "$package"): expected $expected, got $actual"

  unpack_safely "$staging/package.zip" "$staging/unpacked" || fail "the package failed the safety check"
  plugins=$(find "$staging/unpacked" -maxdepth 1 -name '*.uplugin')
  [ "$(printf '%s\n' "$plugins" | grep -c .)" -eq 1 ] || fail "the package must hold exactly one .uplugin file at its root"
  name=$(basename "$plugins" .uplugin)
  [ ! -e "$mods/$name" ] || fail "$mods/$name already exists; remove it first (see the rollback)"

  find "$staging/unpacked" -type d -exec chmod 755 {} +
  find "$staging/unpacked" -type f -exec chmod 644 {} +
  chown -R "$OWNER" "$staging/unpacked"
  mv -- "$staging/unpacked" "$mods/$name"
  echo "install-mod: installed $name ($(find "$mods/$name" -type f | wc -l) files) in $mods"
}

main "$@"
