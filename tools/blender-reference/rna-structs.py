# Writes every RNA struct's properties from Blender itself:
# - rna-structs.json: per struct its base and, per property, [type initial, default] or, for pointers and collections,
#   [type initial, struct] and 1 for a pointer that is never None (by RNA, or in the factory startup's data, where a
#   nested struct such as Object.lineart is there though RNA allows None), so Blender's UI scripts read what Bylonder
#   does not bind as Blender's defaults.
# - rna-ui.json: per struct its name and, per property it adds to its base, what the interface shows: name,
#   description, icon, subtype, unit, read-only, ranges, step and precision, and enum items as
#   [identifier, name, description, icon]. Loaded when an editor first draws properties (makesrna/rna.js).
# usage: blender -b --factory-startup --python tools/blender-reference/rna-structs.py -- STRUCTS.json UI.json
import bpy, json, sys

structs_path, ui_path = sys.argv[sys.argv.index("--") + 1:][:2]


def default(p):
    if p.type in {"BOOLEAN", "INT", "FLOAT"}:
        return list(p.default_array) if getattr(p, "is_array", False) and p.array_length > 0 else p.default
    if p.type == "ENUM":
        return sorted(p.default_flag) if p.is_enum_flag else p.default
    if p.type == "STRING":
        return p.default
    return None


def ui(p):
    d = {"name": p.name}
    for key, value, none in (("description", p.description, ""), ("icon", p.icon, "NONE"), ("subtype", p.subtype, "NONE"),
                             ("unit", p.unit, "NONE")):
        if value != none:
            d[key] = value
    if p.is_readonly:
        d["readonly"] = 1
    if p.type in {"INT", "FLOAT"}:
        d.update(min=p.hard_min, max=p.hard_max, soft_min=p.soft_min, soft_max=p.soft_max, step=p.step)
        if p.type == "FLOAT":
            d["precision"] = p.precision
    if p.type == "ENUM":
        d["items"] = [[i.identifier, i.name, i.description, i.icon] for i in p.enum_items]
        if p.is_enum_flag:
            d["flag"] = 1
    return d


# The pointers set in the factory startup's data: (struct, property) found not None, and never None, walking from
# bpy.data.
present, absent, seen = set(), set(), set()


def walk(value, depth=0):
    rna = getattr(value, "bl_rna", None)
    if rna is None or depth > 4 or id(value) in seen:
        return
    seen.add(id(value))
    for p in rna.properties:
        if p.type == "POINTER" and p.identifier not in {"rna_type", "id_data", "original"}:
            target = getattr(value, p.identifier, None)
            if target is None:
                absent.add((rna.identifier, p.identifier))
            else:
                present.add((rna.identifier, p.identifier))
                walk(target, depth + 1)


for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.scenes, bpy.data.worlds,
                   bpy.data.materials, bpy.data.collections, bpy.data.screens, bpy.data.workspaces, bpy.data.window_managers):
    for data in collection:
        walk(data)

structs, uis = {}, {}
for name in dir(bpy.types):
    rna = getattr(getattr(bpy.types, name), "bl_rna", None)
    if rna is None or rna.identifier != name:
        continue
    inherited = {p.identifier for p in rna.base.properties} if rna.base else set()
    props, own = {}, {}
    for p in rna.properties:
        if p.identifier == "rna_type":
            continue
        entry = [p.type[0]]
        if p.type in {"POINTER", "COLLECTION"}:
            entry.append(p.fixed_type.identifier if p.fixed_type else None)
            if p.type == "POINTER" and (p.is_never_none or (name, p.identifier) in present - absent):
                entry.append(1)
        else:
            entry.append(default(p))
        props[p.identifier] = entry
        if p.identifier not in inherited:
            own[p.identifier] = ui(p)
    structs[name] = {"base": rna.base.identifier if rna.base else None, "props": props}
    uis[name] = {"name": rna.name, "props": own}
for path, data in ((structs_path, structs), (ui_path, uis)):
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("structs written", len(structs))
