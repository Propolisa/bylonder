# Writes every RNA struct's properties to src/makesrna/rna-structs.json: for each struct its base and, per property,
# [type initial, default] or, for pointers and collections, [type initial, struct] and 1 for a pointer that is never
# None, so Blender's UI scripts read
# what Bylonder does not bind as Blender's defaults.
# usage: blender -b --factory-startup --python tools/blender-reference/rna-structs.py -- OUT.json
import bpy, json, sys

out_path = sys.argv[sys.argv.index("--") + 1]


def default(p):
    if p.type in {"BOOLEAN", "INT", "FLOAT"}:
        return list(p.default_array) if getattr(p, "is_array", False) and p.array_length > 0 else p.default
    if p.type == "ENUM":
        return sorted(p.default_flag) if p.is_enum_flag else p.default
    if p.type == "STRING":
        return p.default
    return None


structs = {}
for name in dir(bpy.types):
    rna = getattr(getattr(bpy.types, name), "bl_rna", None)
    if rna is None or rna.identifier != name:
        continue
    props = {}
    for p in rna.properties:
        if p.identifier == "rna_type":
            continue
        entry = [p.type[0]]
        if p.type in {"POINTER", "COLLECTION"}:
            entry.append(p.fixed_type.identifier if p.fixed_type else None)
            if p.type == "POINTER" and p.is_never_none:
                entry.append(1)
        else:
            entry.append(default(p))
        props[p.identifier] = entry
    structs[name] = {"base": rna.base.identifier if rna.base else None, "props": props}
with open(out_path, "w") as f:
    json.dump(structs, f, separators=(",", ":"))
print("structs written", len(structs))
