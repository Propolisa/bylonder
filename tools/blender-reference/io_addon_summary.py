"""What an import made, as JSON-ready data, the same in Blender and in the module's CPython (tests/io-addons-wasm.test.js
runs this file there): each object by name with its type's summary: a mesh's counts, bounds, UV maps, normals and
materials; an armature's bones and their posed heads at frames of its action; a curve's splines and point bounds."""
import bpy


def rounded(values, digits=4):
    return [round(v, digits) + 0.0 for v in values]


def bounds(points):
    points = list(points)
    return [rounded([min(p[i] for p in points) for i in range(3)]), rounded([max(p[i] for p in points) for i in range(3)])] if points else []


def mesh(ob):
    data = ob.data
    return {
        "vertices": len(data.vertices), "edges": len(data.edges), "faces": len(data.polygons), "corners": len(data.loops),
        "bounds": bounds(ob.matrix_world @ v.co for v in data.vertices),
        "uv_layers": [layer.name for layer in data.uv_layers],
        "uv_bounds": [rounded([min(d.uv[i] for d in layer.data) for i in range(2)]) + rounded([max(d.uv[i] for d in layer.data) for i in range(2)])
                      for layer in data.uv_layers],
        "color_attributes": sorted([a.name, a.domain, a.data_type] for a in data.color_attributes),
        "smooth_faces": sum(1 for f in data.polygons if f.use_smooth),
        # The normals Blender draws, per face corner, as one number: the sum of x + 2y + 3z.
        "corner_normals": round(sum(n.vector[0] + 2 * n.vector[1] + 3 * n.vector[2] for n in data.corner_normals), 2),
        "materials": [m.name if m else None for m in data.materials],
    }


def armature(ob):
    action = ob.animation_data.action if ob.animation_data else None
    frames = [int(f) for f in action.frame_range] if action else []
    poses = {}
    for frame in sorted(set(frames + [sum(frames) // 2])) if frames else []:
        bpy.context.scene.frame_set(frame)
        poses[str(frame)] = {bone.name: rounded(ob.matrix_world @ bone.head, 3) for bone in ob.pose.bones}
    return {"bones": [[b.name, b.parent.name if b.parent else None] for b in ob.data.bones], "frames": frames, "poses": poses}


def curve(ob):
    splines = ob.data.splines
    return {
        "dimensions": ob.data.dimensions,
        "splines": [[s.type, len(s.bezier_points) or len(s.points), s.use_cyclic_u] for s in splines],
        "bounds": bounds(ob.matrix_world @ p.co for s in splines for p in s.bezier_points),
        "materials": len(ob.data.materials),
    }


SUMMARIES = {"MESH": mesh, "ARMATURE": armature, "CURVE": curve}


def summary(scene=None):
    """The scene's objects by name: type, transform and the summary of their type."""
    scene = scene or bpy.context.scene
    return {ob.name: {"type": ob.type, "location": rounded(ob.location), "rotation": rounded(ob.rotation_euler), "scale": rounded(ob.scale),
                      **SUMMARIES.get(ob.type, lambda ob: {})(ob)} for ob in sorted(scene.objects, key=lambda o: o.name)}
