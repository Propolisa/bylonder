# Writes the animatable properties of the ID types Bylonder animates, as Blender's RNA defines them
# (src/makesrna/rna-animated.json): per struct, each property's type, subtype, array length, unit and UI name, for the
# module's RNA to resolve and name F-Curve paths as Blender does.
# usage: blender -b --factory-startup --python tools/blender-reference/rna-animated.py -- OUT.json
import bpy, json, sys

out = sys.argv[sys.argv.index("--") + 1]
STRUCTS = {"Object": "OB", "Scene": "SC", "World": "WO", "Material": "MA", "Light": "LA", "Camera": "CA"}
TYPES = ("BOOLEAN", "INT", "FLOAT", "ENUM")
data = {}
for name, code in STRUCTS.items():
    props = {}
    for prop in getattr(bpy.types, name).bl_rna.properties:
        if prop.type in TYPES and prop.is_animatable and not prop.is_readonly:
            props[prop.identifier] = {"type": prop.type, "subtype": prop.subtype, "length": getattr(prop, "array_length", 0),
                                      "unit": getattr(prop, "unit", "NONE"), "name": prop.name}
    data[name] = {"code": code, "properties": props}
with open(out, "w") as f:
    json.dump(data, f, indent=1, sort_keys=True)
print("structs written", len(data))
