# Writes every operator's name by idname to src/makesrna/operator-names.json, the label Blender's menus show for an
# operator entry without its own text.
# usage: blender -b --factory-startup --python tools/blender-reference/operator-names.py -- OUT.json
import bpy, json, sys

out_path = sys.argv[sys.argv.index("--") + 1]
names = {}
for module in dir(bpy.ops):
    for name in dir(getattr(bpy.ops, module)):
        names[module + "." + name] = getattr(getattr(bpy.ops, module), name).get_rna_type().name
with open(out_path, "w") as f:
    json.dump(names, f, indent=0, sort_keys=True)
print("operator names written", len(names))
