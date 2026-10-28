# Writes Blender's default keymaps to tests/fixtures/keymaps.json, which the transpiled keymaps
# (src/bl_ui/blender_default.js, with the parameters src/windowmanager/keyconfig.js gives) must equal: what the default
# key configuration (presets/keyconfig/Blender.py) generates with its default preferences, left click select.
# usage: blender -b --factory-startup --python tools/blender-reference/keymaps.py -- OUT.json
import bpy, json, os, sys

presets = os.path.join(bpy.utils.resource_path('LOCAL'), 'scripts', 'presets', 'keyconfig')
sys.path.insert(0, presets)
import bl_keymap_utils.io
import Blender

generated = []
bl_keymap_utils.io.keyconfig_init_from_data = lambda kc, data: generated.append(data)
bpy.utils.register_class(Blender.Prefs)
Blender.load()

out_path = sys.argv[sys.argv.index("--") + 1]
with open(out_path, "w") as f:
    json.dump(generated[-1], f, separators=(",", ":"))
print("keymaps written")
