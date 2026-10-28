# Writes the RNA definition of Curve and Text data (Curve, TextCurve and their splines, points, text boxes and character
# formats, with their properties as modifiers.py writes them, enum values included) to src/makesrna/rna-curves.json;
# with dna-curves.json (tools/blender-port/modifier_dna.py SRC curves) JS reads and writes them in the module.
# usage: blender -b --factory-startup --python tools/blender-reference/curves.py -- OUT.json
import bpy, json, os, sys

sys.path.append(os.path.dirname(__file__))
from operators import prop as operator_prop


def prop(p):
    """As modifiers.py writes a property: with each enum item's value, which is what Blender stores."""
    d = operator_prop(p)
    if p.type == "ENUM":
        d["items"] = [[i.identifier, i.name, i.description, i.value] for i in p.enum_items]
    return d


STRUCTS = ["Curve", "TextCurve", "Spline", "SplinePoint", "BezierSplinePoint", "TextBox", "TextCharacterFormat"]
out_path = sys.argv[sys.argv.index("--") + 1]
id_props = {p.identifier for p in bpy.types.ID.bl_rna.properties}
out = {}
for name in STRUCTS:
    rna = getattr(bpy.types, name).bl_rna
    base = {p.identifier for p in rna.base.properties} if rna.base and rna.base.identifier != "ID" else id_props
    out[name] = {"base": rna.base.identifier if rna.base else None,
                 "properties": {p.identifier: prop(p) for p in rna.properties if p.identifier not in base and p.identifier != "rna_type"}}
with open(out_path, "w") as f:
    json.dump(out, f, indent=1)
print("curves written", len(out))
