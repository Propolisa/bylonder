# Writes the idnames of Blender's operators with the REGISTER option (OPTYPE_REGISTER), whose calls Blender reports
# to the Info editor (wm_operator_reports), to src/windowmanager/operator-register.json.
# usage: blender -b --factory-startup --python tools/blender-reference/operator-register.py -- OUT.json
import bpy, json, sys

out = sys.argv[sys.argv.index("--") + 1]
names = sorted(
    f"{module}.{name}"
    for module in dir(bpy.ops)
    for name in dir(getattr(bpy.ops, module))
    if "REGISTER" in getattr(getattr(bpy.ops, module), name).bl_options
)
with open(out, "w") as f:
    json.dump(names, f, indent=0)
print("operators written", len(names))
