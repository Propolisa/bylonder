# Writes Blender's default keymaps (keymap_data/blender_default.py's generate_keymaps() with default parameters) to
# tests/fixtures/keymaps.json, which the transpiled keymaps (src/bl_ui/blender_default.js) must equal.
# usage: blender -b --factory-startup --python tools/blender-reference/keymaps.py -- OUT.json
import bpy, json, os, sys

sys.path.insert(0, os.path.join(bpy.utils.resource_path('LOCAL'), 'scripts', 'presets', 'keyconfig', 'keymap_data'))
import blender_default

out_path = sys.argv[sys.argv.index("--") + 1]
with open(out_path, "w") as f:
    json.dump(blender_default.generate_keymaps(), f, separators=(",", ":"))
print("keymaps written")
