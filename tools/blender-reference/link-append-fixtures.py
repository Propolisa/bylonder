# Writes Blender's own Link and Append results as fixtures (tests/fixtures/link-append/): host.blend, an empty scene, and
# what File > Link and File > Append make in it with their default options from the Link and Append example's library
# (examples/link-append/libraries/library.blend, written by link-append.py: a collection of a lamp post, its lantern and
# light, a bench outside it and a material no object uses), then a library override of the linked collection
# (link-append.json).
# usage: blender -b --factory-startup --python tools/blender-reference/link-append-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
os.makedirs(out, exist_ok=True)
LIBRARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../examples/link-append/libraries/library.blend")
HOST = os.path.join(out, "host.blend")
# (operator, ID type folder, name) as the File Browser sets them inside the library.
CASES = {
    "link_collection": ("link", "Collection", "Street Lamp"),
    "append_collection": ("append", "Collection", "Street Lamp"),
    "link_object": ("link", "Object", "Bench"),
    "append_object": ("append", "Object", "Bench"),
    "link_material": ("link", "Material", "Cobblestone"),
    "append_material": ("append", "Material", "Cobblestone"),
}


def host():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=HOST)


def rounded(values):
    return [round(v, 4) for v in values]


def idsummary(id):
    return {"name": id.name, "library": os.path.basename(id.library.filepath) if id.library else None,
            "override": ("SYSTEM" if id.override_library.is_system_override else "USER") if id.override_library else None,
            "users": id.users}


def collection(c):
    return {"name": c.name, "objects": sorted(o.name for o in c.objects), "children": [collection(child) for child in c.children]}


def summary():
    scene = bpy.context.scene
    return {
        "libraries": sorted(os.path.basename(lib.filepath) for lib in bpy.data.libraries),
        "collections": sorted((idsummary(c) for c in bpy.data.collections), key=lambda s: (s["name"], s["library"] or "")),
        "objects": sorted(({**idsummary(o), "type": o.type, "location": rounded(o.matrix_world.translation),
                            "instance_collection": o.instance_collection.name if o.instance_collection else None,
                            "in_scene": o.name in scene.objects, "selected": o.select_get() if o.name in scene.objects else False,
                            "materials": [s.material.name if s.material else None for s in o.material_slots]}
                           for o in bpy.data.objects), key=lambda s: (s["name"], s["library"] or "")),
        "materials": sorted((idsummary(m) for m in bpy.data.materials), key=lambda s: (s["name"], s["library"] or "")),
        "meshes": sorted((idsummary(m) for m in bpy.data.meshes), key=lambda s: (s["name"], s["library"] or "")),
        "scene": collection(scene.collection),
    }


host()
reference = {}
for case, (op, folder, name) in CASES.items():
    bpy.ops.wm.open_mainfile(filepath=HOST)
    getattr(bpy.ops.wm, op)(directory=os.path.join(LIBRARY, folder) + "/", filename=name, files=[{"name": name}])
    reference[case] = summary()
# Object > Library Override > Make on the instance the linked collection made, as the 3D View runs it.
bpy.ops.wm.open_mainfile(filepath=HOST)
bpy.ops.wm.link(directory=os.path.join(LIBRARY, "Collection") + "/", filename="Street Lamp", files=[{"name": "Street Lamp"}])
bpy.context.view_layer.objects.active = bpy.data.objects["Street Lamp"]
bpy.ops.object.make_override_library()
reference["override_collection"] = summary()
json.dump(reference, open(os.path.join(out, "link-append.json"), "w"), indent=1)
print("wrote", out)
