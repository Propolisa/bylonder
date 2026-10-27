# Writes the RNA definition of every operator (name, description, properties with defaults, limits, enum items as
# [identifier, name, description, icon]) to src/makesrna/rna-operators.json, for the labels and enum entries Blender's
# menus show and the fields of Bylonder's operator panels.
# usage: blender -b --factory-startup --python tools/blender-reference/operators.py -- OUT.json
import bpy, json, sys

def prop(p):
    d = {"name": p.name, "description": p.description, "type": p.type}
    if p.subtype != "NONE":
        d["subtype"] = p.subtype
    if p.type in ("INT", "FLOAT"):
        d.update(min=p.hard_min, max=p.hard_max, soft_min=p.soft_min, soft_max=p.soft_max, step=p.step)
        if p.type == "FLOAT":
            d["precision"] = p.precision
            if p.unit != "NONE":
                d["unit"] = p.unit
        d["default"] = list(p.default_array) if p.is_array else p.default
        if p.is_array:
            d["size"] = p.array_length
    elif p.type == "BOOLEAN":
        d["default"] = list(p.default_array) if p.is_array else p.default
    elif p.type == "ENUM":
        d["items"] = [[i.identifier, i.name, i.description, i.icon] for i in p.enum_items]
        d["default"] = sorted(p.default_flag) if p.is_enum_flag else p.default
    elif p.type == "STRING":
        d["default"] = p.default
    elif p.type == "POINTER":
        d["fixed_type"] = p.fixed_type.identifier
    if p.is_hidden:
        d["hidden"] = True
    if p.is_skip_save:
        d["skip_save"] = True
    return d


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    out_path = args[0]
    out = {}
    for module in dir(bpy.ops):
        for name in dir(getattr(bpy.ops, module)):
            idname = module + "." + name
            rna = getattr(getattr(bpy.ops, module), name).get_rna_type()
            out[idname] = {"name": rna.name, "description": rna.description,
                           "properties": {p.identifier: prop(p) for p in rna.properties if p.identifier != "rna_type"}}
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    print("operators written", len(out))
