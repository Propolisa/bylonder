# Writes Blender's own import and export results as fixtures (tests/fixtures/io/): Suzanne, moved and rotated, with its
# UV map, a color attribute, smooth faces and a material, exported by Blender's OBJ, PLY, STL and FBX exporters;
# the scene saved as suzanne.blend; then each file imported by Blender's importer into an empty scene, with what the
# import made (io-import.json): objects, counts, bounds, UV maps, color attributes, normals and materials.
# usage: blender -b --factory-startup --python tools/blender-reference/io-fixtures.py -- OUT_DIR
import bpy, json, os, sys

out = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out, exist_ok=True)
FILES = {
    "obj": ("suzanne.obj", "wm.obj_export", {}, "wm.obj_import"),
    "ply": ("suzanne.ply", "wm.ply_export", {"export_colors": "SRGB"}, "wm.ply_import"),
    "stl": ("suzanne.stl", "wm.stl_export", {}, "wm.stl_import"),
    "fbx": ("suzanne.fbx", "export_scene.fbx", {}, "wm.fbx_import"),
}


def operator(idname):
    prefix, name = idname.split(".")
    return getattr(getattr(bpy.ops, prefix), name)


def empty_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def suzanne():
    bpy.ops.mesh.primitive_monkey_add(location=(1.0, -2.0, 0.5), rotation=(0.3, 0.0, 0.7))
    ob = bpy.context.object
    ob.name = "Suzanne"
    mesh = ob.data
    color = mesh.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    for i, value in enumerate(color.data):
        value.color = ((i % 7) / 6, (i % 5) / 4, (i % 3) / 2, 1.0)
    for i, face in enumerate(mesh.polygons):
        face.use_smooth = i % 2 == 0
    material = bpy.data.materials.new("Skin")
    material.diffuse_color = (0.8, 0.3, 0.2, 1.0)
    mesh.materials.append(material)
    return ob


def rounded(values):
    return [round(v, 4) for v in values]


def summary(ob):
    mesh = ob.data
    world = [ob.matrix_world @ v.co for v in mesh.vertices]
    return {
        "name": ob.name,
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "faces": len(mesh.polygons),
        "corners": len(mesh.loops),
        "bounds": [rounded([min(p[i] for p in world) for i in range(3)]), rounded([max(p[i] for p in world) for i in range(3)])],
        "location": rounded(ob.location),
        "rotation": rounded(ob.rotation_euler),
        "uv_layers": [layer.name for layer in mesh.uv_layers],
        "uv_bounds": [rounded([min(d.uv[i] for d in layer.data) for i in range(2)]) + rounded([max(d.uv[i] for d in layer.data) for i in range(2)])
                      for layer in mesh.uv_layers],
        "color_attributes": [[a.name, a.domain, a.data_type] for a in mesh.color_attributes],
        "smooth_faces": sum(1 for f in mesh.polygons if f.use_smooth),
        "custom_normals": mesh.has_custom_normals,
        # The normals Blender draws, per face corner, as one number: the sum of x + 2y + 3z.
        "corner_normals": round(sum(n.vector[0] + 2 * n.vector[1] + 3 * n.vector[2] for n in mesh.corner_normals), 3),
        "materials": [m.name if m else None for m in mesh.materials],
    }


empty_scene()
source = suzanne()
reference = {"source": summary(source), "imports": {}}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "suzanne.blend"), compress=True)
for kind, (name, export, options, _) in FILES.items():
    source.select_set(True)
    operator(export)(filepath=os.path.join(out, name), **options)
for kind, (name, _, _, imp) in FILES.items():
    empty_scene()
    operator(imp)(filepath=os.path.join(out, name))
    reference["imports"][kind] = [summary(ob) for ob in sorted(bpy.context.scene.objects, key=lambda o: o.name)]
json.dump(reference, open(os.path.join(out, "io-import.json"), "w"), indent=1)
print("wrote", out)
