#!/bin/bash
# Screenshots of Blender's own UI, as a reference for comparing Bylonder's. Runs CPU-only (Xvfb, Mesa llvmpipe)
# and needs Xvfb, Mesa and ImageMagick. Linux only. The reference Blender is install.mjs's.
# usage: tools/blender-reference/capture.sh Layout Compositing Video_Editing ...
#   a name is a workspace of the default file, or an app template (Video_Editing, 2D_Animation, VFX, ...)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cache="$root/.tools/blender"
blender=$(node "$root/tools/blender-reference/install.mjs")
mkdir -p "$cache/shots"
# Opening a file skips the splash screen.
[ -f "$cache/start.blend" ] || "$blender" -b --factory-startup --python-expr "import bpy; bpy.ops.wm.save_as_mainfile(filepath='$cache/start.blend')" >/dev/null
for name in "$@"; do
  Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 & xvfb=$!
  sleep 1
  DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe "$blender" --factory-startup "$cache/start.blend" \
    --python "$root/tools/blender-reference/show.py" -- "$name" >"$cache/blender.log" 2>&1 & app=$!
  sleep 20
  DISPLAY=:99 import -window root "$cache/shots/$name.png"
  kill $app $xvfb 2>/dev/null || true
  wait 2>/dev/null || true
  echo "$cache/shots/$name.png"
done
