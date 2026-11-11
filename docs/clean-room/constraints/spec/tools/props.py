# Lists each constraint type's properties, enum items and default values as Blender reports them.
import bpy, sys, json
out = sys.argv[sys.argv.index("--") + 1]
ob = bpy.data.objects.new("O", None); bpy.context.scene.collection.objects.link(ob)
arm = bpy.data.objects.new("A", bpy.data.armatures.new("A")); bpy.context.scene.collection.objects.link(arm)
skip = {"rna_type", "name", "type", "is_valid", "error_location", "error_rotation", "is_override_data_editable", "active", "show_expanded"}
res = {}
for t in [i.identifier for i in bpy.types.Constraint.bl_rna.properties["type"].enum_items]:
    c = ob.constraints.new(t)
    props = {}
    for p in c.bl_rna.properties:
        if p.identifier in skip: continue
        v = getattr(c, p.identifier, None)
        if hasattr(v, "__len__") and not isinstance(v, str): v = [round(x, 6) if isinstance(x, float) else x for x in v] if p.type in ("FLOAT", "INT", "BOOLEAN") else str(type(v).__name__)
        elif isinstance(v, bpy.types.ID) or v is None: v = None if v is None else v.name
        elif not isinstance(v, (int, float, str, bool)): v = str(v)
        e = {"value": v, "type": p.type}
        if p.type == "ENUM": e["items"] = [i.identifier for i in p.enum_items]
        if p.type in ("FLOAT", "INT"): e["range"] = [p.hard_min, p.hard_max]
        if p.description: e["description"] = p.description
        props[p.identifier] = e
    res[t] = props
    ob.constraints.remove(c)
json.dump(res, open(out, "w"), indent=1, default=lambda o: [round(x, 6) for x in o])
