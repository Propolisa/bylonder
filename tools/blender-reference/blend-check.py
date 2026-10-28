# Reads a .blend Bylonder saved (File > Save As, Blender's writer in the module) and prints what Blender sees in it as
# JSON: the scene's frame range and render settings, its world, each object's type, transform, parent, data, material
# slots, modifiers and animation, and each material's Principled BSDF inputs. With a PNG path, renders the scene's
# current frame there.
# usage: blender -b FILE.blend --python tools/blender-reference/blend-check.py -- [OUT.png [ENGINE [SAMPLES [PERCENT]]]]
# A render also prints the mean color of its middle and of its corners (BLEND-RENDER), for a test to see the scene.
import bpy, json, sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
scene = bpy.context.scene


def values(v):
    return [round(x, 5) for x in v]


def socket(s):
    if not hasattr(s, "default_value"):
        return None
    v = s.default_value
    return round(v, 5) if isinstance(v, float) else v if isinstance(v, (int, bool, str)) else values(v)


def tree(owner):
    nt = owner.node_tree
    if not nt:
        return None
    return {"nodes": {n.name: {"type": n.bl_idname, "inputs": {i.identifier: socket(i) for i in n.inputs if not i.is_linked and socket(i) is not None}}
                      for n in nt.nodes},
            "links": [[l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier] for l in nt.links]}


def animation(ob):
    action = ob.animation_data and ob.animation_data.action
    if not action:
        return None
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves += [{"path": f.data_path, "index": f.array_index, "keys": [values(k.co) for k in f.keyframe_points]} for f in bag.fcurves]
    return {"action": action.name, "fcurves": curves}


def modifier(m):
    keys = {"SUBSURF": ["levels", "render_levels"], "ARRAY": ["count", "relative_offset_displace"], "MIRROR": ["use_axis"], "SOLIDIFY": ["thickness"],
            "BEVEL": ["width", "segments"]}.get(m.type, [])
    return {"name": m.name, "type": m.type, "show_viewport": m.show_viewport, "show_render": m.show_render,
            **{k: (values(getattr(m, k)) if hasattr(getattr(m, k), "__len__") else getattr(m, k)) for k in keys}}


def data(ob):
    d = ob.data
    if d is None:
        return None
    out = {"name": d.name, "type": type(d).__name__}
    if ob.type == "MESH":
        out.update(verts=len(d.vertices), faces=len(d.polygons), uv_layers=[u.name for u in d.uv_layers])
    elif ob.type == "LIGHT":
        out.update(light=d.type, color=values(d.color), energy=round(d.energy, 4))
    elif ob.type == "CAMERA":
        out.update(camera=d.type, lens=round(d.lens, 4), clip=[round(d.clip_start, 4), round(d.clip_end, 4)], sensor_fit=d.sensor_fit)
    elif ob.type in ("CURVE", "FONT"):
        out.update(splines=len(d.splines), **({"body": d.body} if ob.type == "FONT" else {}))
    return out


report = {
    "scene": {"name": scene.name, "frame": [scene.frame_start, scene.frame_current, scene.frame_end], "fps": scene.render.fps,
              "resolution": [scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage],
              "camera": scene.camera.name if scene.camera else None, "engine": scene.render.engine},
    "world": scene.world and {"name": scene.world.name, "tree": tree(scene.world)},
    "collections": {c.name: [o.name for o in c.objects] for c in bpy.data.collections},
    "objects": {ob.name: {"type": ob.type, "location": values(ob.location), "rotation_mode": ob.rotation_mode,
                          "rotation": values(ob.rotation_quaternion if ob.rotation_mode == "QUATERNION" else ob.rotation_euler), "scale": values(ob.scale),
                          "parent": ob.parent.name if ob.parent else None, "hide_render": ob.hide_render, "data": data(ob),
                          "materials": [s.material.name if s.material else None for s in ob.material_slots],
                          "modifiers": [modifier(m) for m in ob.modifiers], "animation": animation(ob),
                          "bylonder_id": ob.get("bylonder_id")}
                for ob in scene.objects},
    "materials": {m.name: {"tree": tree(m), "users": m.users} for m in bpy.data.materials},
}
print("BLEND-CHECK " + json.dumps(report))

if args:
    scene.render.engine = args[1] if len(args) > 1 else "CYCLES"
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = int(args[2]) if len(args) > 2 else 32
        scene.cycles.device = "CPU"
    if len(args) > 3:
        scene.render.resolution_percentage = int(args[3])
    scene.render.filepath = args[0]
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(args[0])
    w, h = image.size
    pixels = image.pixels[:]

    def mean(points):
        return [round(sum(pixels[(y * w + x) * 4 + c] for x, y in points) / len(points), 4) for c in range(3)]

    middle = [(x, y) for x in range(w * 2 // 5, w * 3 // 5) for y in range(h * 2 // 5, h * 3 // 5)]
    corners = [(x, y) for x in (0, w - 1) for y in (0, h - 1)]
    print("BLEND-RENDER " + json.dumps({"middle": mean(middle), "corners": mean(corners)}))
