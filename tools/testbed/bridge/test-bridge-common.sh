#!/usr/bin/env bash
# Shared setup for the bridge tests in this folder. It adds to ../test-common.sh (temporary
# work directory, `check`, cleanup on exit) the paths and helpers that every bridge test uses.
# Source this file; do not run it.

source "$(dirname "${BASH_SOURCE[0]}")/../test-common.sh"

bridge="$here/bridge"
repo=$(cd "$here/../.." && pwd)
# The tests run as an ordinary user, so every script gets the current user as the "game" owner.
owner="$(id -un):$(id -gn)"

mode_of() { stat -c '%a' "$1"; }
# True when the command fails. Output is hidden, so a test never prints a secret by accident.
refuses() { ! "$@" >/dev/null 2>&1; }
# True when the file contains the fixed string.
contains() { grep -qF -- "$2" "$1"; }
