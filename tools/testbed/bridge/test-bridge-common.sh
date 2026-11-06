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

runbook="$here/bridge-runbook.md"

# runbook_block <heading-regex> prints the first bash block that follows the matching line of
# the runbook. The tests run the runbook's own text, so a change of a command is tested.
runbook_block() {
  awk -v pattern="$1" '$0 ~ pattern { found = 1; next } found && /^```bash/ { inside = 1; next } inside && /^```/ { exit } inside { print }' "$runbook"
}

# has_secret <file> <secret> is true when the file holds the secret. The secret goes in on
# standard input (a here-string is a shell built-in), so no process gets it as an argument.
has_secret() { grep -qF -f - "$1" <<<"$2"; }
lacks_secret() { ! has_secret "$@"; }
# quietly <command> runs the command with its output hidden; its exit status is the result.
quietly() { "$@" >/dev/null 2>&1; }
