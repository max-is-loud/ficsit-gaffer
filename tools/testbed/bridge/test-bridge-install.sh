#!/usr/bin/env bash
# Tests install-mod.sh and the pinned package list with small fake packages in a temporary
# directory. No server and no real package is involved.
# Usage:  test-bridge-install.sh   (exit 0 = all checks passed)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/test-bridge-common.sh"

# make_zip <zip> <name=content>... writes a zip file with the given entries.
make_zip() {
  local zip=$1
  shift
  python3 -I - "$zip" "$@" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as package:
    for item in sys.argv[2:]:
        name, _, content = item.partition("=")
        package.writestr(name, content)
PY
}

pin() { printf '%s  %s\n' "$(sha256sum "$1" | cut -d' ' -f1)" "$(basename "$1")" >>"$work/pins"; }

install_mod() {
  GAFFER_PACKAGE_PINS="$work/pins" GAFFER_MOD_OWNER="$owner" "$bridge/install-mod.sh" "$@"
}

test_install_and_modes() {
  make_zip "$work/Good-1.0-LinuxServer.zip" 'Good.uplugin={}' 'Binaries/Linux/libGood.so=binary' 'Config/Good.ini=x'
  pin "$work/Good-1.0-LinuxServer.zip"
  install_mod "$work/Good-1.0-LinuxServer.zip" "$work/game/Mods" >/dev/null
  check "the mod folder is named after the .uplugin file" test -f "$work/game/Mods/Good/Good.uplugin"
  check "nested files arrive" test -f "$work/game/Mods/Good/Binaries/Linux/libGood.so"
  check "a new Mods directory is readable by the game (755)" test "$(mode_of "$work/game/Mods")" = 755
  check "directories are 755" test "$(mode_of "$work/game/Mods/Good/Binaries")" = 755
  check "files are 644" test "$(mode_of "$work/game/Mods/Good/Good.uplugin")" = 644
  check "no staging directory is left behind" test -z "$(find "$work/game/Mods" -maxdepth 1 -name '.staging.*')"
}

test_refusals() {
  make_zip "$work/Twice-1.0-LinuxServer.zip" 'Twice.uplugin=old'
  pin "$work/Twice-1.0-LinuxServer.zip"
  install_mod "$work/Twice-1.0-LinuxServer.zip" "$work/game/Mods" >/dev/null
  make_zip "$work/Twice-1.0-LinuxServer.zip" 'Twice.uplugin=new'
  grep -v 'Twice-1.0' "$work/pins" >"$work/pins.next" && mv "$work/pins.next" "$work/pins" && pin "$work/Twice-1.0-LinuxServer.zip"
  check "install refuses to replace an existing mod folder" refuses install_mod "$work/Twice-1.0-LinuxServer.zip" "$work/game/Mods"
  check "the existing mod folder is untouched" test "$(cat "$work/game/Mods/Twice/Twice.uplugin")" = old

  make_zip "$work/Loose-1.0-LinuxServer.zip" 'Loose.uplugin=x'
  check "install refuses a package that is not in the pin list" refuses install_mod "$work/Loose-1.0-LinuxServer.zip" "$work/game/Mods"
  pin "$work/Loose-1.0-LinuxServer.zip"
  make_zip "$work/Loose-1.0-LinuxServer.zip" 'Loose.uplugin=changed after pinning'
  check "install refuses a package whose SHA-256 differs from the pin" refuses install_mod "$work/Loose-1.0-LinuxServer.zip" "$work/game/Mods"
  check "a refused install leaves no folder" test ! -e "$work/game/Mods/Loose"
  check "a refused install leaves no staging directory" test -z "$(find "$work/game/Mods" -maxdepth 1 -name '.staging.*')"
}

test_unsafe_packages() {
  make_zip "$work/Slip-1.0-LinuxServer.zip" 'Slip.uplugin=x' '../escaped.txt=x'
  make_zip "$work/Abs-1.0-LinuxServer.zip" 'Abs.uplugin=x' '/etc/escaped.txt=x'
  make_zip "$work/Two-1.0-LinuxServer.zip" 'A.uplugin=x' 'B.uplugin=x'
  make_zip "$work/None-1.0-LinuxServer.zip" 'readme.txt=x'
  python3 -I - "$work/Link-1.0-LinuxServer.zip" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as package:
    package.writestr("Link.uplugin", "x")
    link = zipfile.ZipInfo("Link/target")
    link.external_attr = 0o120777 << 16
    package.writestr(link, "/etc/passwd")
PY
  local name
  for name in Slip Abs Two None Link; do pin "$work/$name-1.0-LinuxServer.zip"; done
  check "install refuses a '..' entry" refuses install_mod "$work/Slip-1.0-LinuxServer.zip" "$work/game/Mods"
  check "install refuses an absolute entry" refuses install_mod "$work/Abs-1.0-LinuxServer.zip" "$work/game/Mods"
  check "install refuses a package with two .uplugin files" refuses install_mod "$work/Two-1.0-LinuxServer.zip" "$work/game/Mods"
  check "install refuses a package with no .uplugin file" refuses install_mod "$work/None-1.0-LinuxServer.zip" "$work/game/Mods"
  check "install refuses a symbolic link entry" refuses install_mod "$work/Link-1.0-LinuxServer.zip" "$work/game/Mods"
  check "nothing escaped the Mods directory" test ! -e "$work/game/escaped.txt"
  check "no unsafe package left a folder" test -z "$(find "$work/game/Mods" -maxdepth 1 \( -name Slip -o -name Abs -o -name Two -o -name Link \))"
}

test_committed_pins() {
  local pins="$bridge/packages.sha256"
  check "the committed pin list has exactly two entries" test "$(grep -c . "$pins")" -eq 2
  check "every pin is a SHA-256 and a .zip name" test "$(grep -cE '^[0-9a-f]{64}  [A-Za-z0-9._-]+\.zip$' "$pins")" -eq 2
  check "the bridge package is pinned" grep -q '  ForemanBridge-0.1.0-LinuxServer.zip$' "$pins"
  check "the SML package is pinned" grep -q '  SML-3.12.0-LinuxServer.zip$' "$pins"
  local files="$bridge/foreman-bridge-files.sha256" uplugin_hash
  check "the plugin file list has the eight files of the package" test "$(grep -cE '^[0-9a-f]{64}  [A-Za-z0-9._/-]+$' "$files")" -eq 8
  uplugin_hash=$(sed -n 's/^\([0-9a-f]\{64\}\)  ForemanBridge.uplugin$/\1/p' "$files")
  check "the packaged .uplugin is the one that source-manifest.json records for this repository" \
    contains "$repo/integrations/foreman-bridge/source-manifest.json" "$uplugin_hash"
}

mkdir -p "$work/game"
test_install_and_modes
test_refusals
test_unsafe_packages
test_committed_pins
echo "all $passed checks passed"
