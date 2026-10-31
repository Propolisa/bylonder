#!/bin/bash
# Installs the reference Blender: the release of the version the module is built from (tools/blender-port/manifest.json
# "blender"), into .blender-reference/ (git-ignored), once. Prints the executable's path.
# usage: tools/blender-reference/install.sh   (BLENDER_REFERENCE: another directory to install into)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
version=$(sed -n 's/^ *"blender": *"v\([0-9.]*\)".*/\1/p' "$root/tools/blender-port/manifest.json")
cache="${BLENDER_REFERENCE:-$root/.blender-reference}"
blender="$cache/blender-$version-linux-x64/blender"
if [ ! -x "$blender" ]; then
  mkdir -p "$cache"
  curl -fsSL "https://download.blender.org/release/Blender${version%.*}/blender-$version-linux-x64.tar.xz" | tar -xJ -C "$cache"
fi
"$blender" --version >/dev/null
echo "$blender"
