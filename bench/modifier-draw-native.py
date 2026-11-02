# bench/modifier-draw.bench.js's cases in Blender itself, for reference: a modifier value set, the depsgraph's
# evaluation, then what the draw cache computes from the evaluated Mesh (normals, triangles).
# usage: blender -b --factory-startup [-t 1] --python bench/modifier-draw-native.py -- [runs]
import sys
import time
import bpy

runs = int(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 1 else 5


def grid(name, side):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=side, y_subdivisions=side, size=2, calc_uvs=True)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def subdivide_group():
    group = bpy.data.node_groups.new("Subdivide", "GeometryNodeTree")
    for in_out in ("INPUT", "OUTPUT"):
        group.interface.new_socket(name="Geometry", in_out=in_out, socket_type="NodeSocketGeometry")
    nodes = [group.nodes.new(idname) for idname in ("NodeGroupInput", "NodeGroupOutput", "GeometryNodeSubdivideMesh")]
    group.links.new(nodes[0].outputs[0], nodes[2].inputs[0])
    group.links.new(nodes[2].outputs[0], nodes[1].inputs[0])
    return group, nodes[2]


def case(name, faces):
    side = lambda n: round(n ** 0.5)
    if name == "Subdivision":
        ob = grid(name, side(faces / 16))
        md = ob.modifiers.new(name, "SUBSURF")
        return ob, lambda v: setattr(md, "levels", v), 1, 2
    if name == "Array":
        ob = grid(name, side(faces / 10))
        md = ob.modifiers.new(name, "ARRAY")
        return ob, lambda v: setattr(md, "count", v), 9, 10
    if name == "Displace":
        ob = grid(name, side(faces))
        md = ob.modifiers.new(name, "DISPLACE")
        md.texture = bpy.data.textures.new("Clouds", "CLOUDS")
        return ob, lambda v: setattr(md, "strength", v), 0.5, 0.6
    ob = grid(name, side(faces / 16))
    group, subdivide = subdivide_group()
    ob.modifiers.new(name, "NODES").node_group = group
    return ob, lambda v: setattr(subdivide.inputs[1], "default_value", v), 1, 2


def extract(ob, depsgraph):
    me = ob.evaluated_get(depsgraph).data
    me.vertex_normals[0].vector
    me.corner_tris if hasattr(me, "corner_tris") else me.loop_triangles[0]
    return len(me.polygons)


bpy.ops.wm.read_factory_settings(use_empty=True)
print(f"{'case':26} {'faces':>8}   evaluate  extract  (ms, median of {runs}, {bpy.app.binary_path_python if False else 'threads ' + str(bpy.context.scene.render.threads)})")
for size, faces in (("100k", 1e5), ("1M", 1e6)):
    for name in ("Subdivision", "Array", "Displace", "Geometry Nodes"):
        ob, set_value, start, end = case(name, faces)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluate, extracted = [], []
        for _ in range(runs + 1):
            set_value(start)
            depsgraph.update()
            extract(ob, depsgraph)
            set_value(end)
            t0 = time.perf_counter()
            depsgraph.update()
            t1 = time.perf_counter()
            count = extract(ob, depsgraph)
            t2 = time.perf_counter()
            evaluate.append((t1 - t0) * 1000)
            extracted.append((t2 - t1) * 1000)
        median = lambda v: sorted(v[1:])[len(v[1:]) // 2]
        print(f"{name + ' ' + size:26} {count:>8}  {median(evaluate):7.1f}  {median(extracted):7.1f}")
        bpy.data.objects.remove(ob)
