# Writes the RNA definition of modifiers (type enum, and each type's struct with its properties as operators.py writes
# them) to src/makesrna/rna-modifiers.json, so Bylonder's modifier panels show Blender's fields.
# usage: blender -b --factory-startup --python tools/blender-reference/modifiers.py -- OUT.json
import bpy, json, os, sys

sys.path.append(os.path.dirname(__file__))
from operators import prop as operator_prop



def prop(p):
    """As operators.py writes a property, with each enum item's value, which is what Blender stores."""
    d = operator_prop(p)
    if p.type == "ENUM":
        d["items"] = [[i.identifier, i.name, i.description, i.value] for i in p.enum_items]
    return d


out_path = sys.argv[sys.argv.index("--") + 1]
mesh = bpy.data.meshes.new("modifiers")
ob = bpy.data.objects.new("modifiers", mesh)
base = {p.identifier for p in bpy.types.Modifier.bl_rna.properties}
out = {"Modifier": {p.identifier: prop(p) for p in bpy.types.Modifier.bl_rna.properties if p.identifier != "rna_type"}, "types": {}}
for item in bpy.types.Modifier.bl_rna.properties["type"].enum_items:
    md = ob.modifiers.new(item.name, item.identifier)
    if md is None:  # A type a mesh object cannot have (Grease Pencil's).
        continue
    rna = md.bl_rna
    out["types"][item.identifier] = {"value": item.value, "name": item.name, "description": item.description, "icon": item.icon,
                                     "struct": rna.identifier,
                                     "properties": {p.identifier: prop(p) for p in rna.properties if p.identifier not in base}}
    ob.modifiers.remove(md)
with open(out_path, "w") as f:
    json.dump(out, f, indent=1)
print("modifiers written", len(out["types"]))
