# Blender's side of tools/docs/acting-face-check.mjs: the shot's head as Blender evaluates it at frames, its mouth
# opening (lower to upper lip vertex) and jaw (chin to nose tip vertex), the vertices nearest those bones' rest heads.
#   usage: blender -y -b <shot.blend> --python acting-blender.py -- <frames comma separated>
import bpy, sys, json
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
frames = [int(f) for f in args[0].split(',')]
POINTS = {'lower': 'DEF-OuterLip_Bot_Center', 'upper': 'DEF-OuterLip_Top0.L', 'chin': 'DEF-Chin', 'nose': 'DEF-Nose',
          'cheekL': 'DEF-Cheek2_2.L', 'cheekR': 'DEF-Cheek2_2.R', 'neck': 'DEF-Neck'}
# A second argument: the action to play on RIG-Snow (our file, where it sits on a muted NLA track), alone.
if len(args) > 1:
    rig = bpy.data.objects['RIG-Snow']
    rig.animation_data.use_nla = False
    rig.animation_data.action = bpy.data.actions[args[1]]
    if not rig.animation_data.action_slot and len(rig.animation_data.action.slots) == 1:
        rig.animation_data.action_slot = rig.animation_data.action.slots[0]
rig = next(ob for ob in bpy.data.objects if ob.type == 'ARMATURE' and ob.animation_data and ob.animation_data.action)
head = bpy.data.objects.get('GEO-snow_head') or bpy.data.objects['GEO-snow-head']
scene, dg = bpy.context.scene, bpy.context.evaluated_depsgraph_get()
import os
if os.environ.get('NO_KEYS') and head.data.shape_keys:
    for kb in head.data.shape_keys.key_blocks[1:]:
        kb.mute = True
# The head as a render evaluates it: its modifiers shown as in renders (Snow's face lattices are render-only).
for m in head.modifiers:
    m.show_viewport = m.show_render
if os.environ.get('NO_LATTICE'):
    for m in head.modifiers:
        if m.type == 'LATTICE':
            m.show_viewport = False
# Subdivision off, so the evaluated vertices are the mesh's own and its vertex groups pick them.
for m in head.modifiers:
    if m.type == 'SUBSURF':
        m.show_viewport = False
body = bpy.data.objects['GEO-snow-body']
for m in body.modifiers:
    m.show_viewport = m.show_render and m.type != 'SUBSURF'
def positions(ob=head):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    out = [ev.matrix_world @ v.co for v in mesh.vertices]
    ev.to_mesh_clear()
    return out
# Each point: the vertex weighted most to its bone.
def heaviest(name):
    group = head.vertex_groups[name].index
    return max(((g.weight, v.index) for v in head.data.vertices for g in v.groups if g.group == group), default=(0, -1))[1]
vertex = {k: heaviest(n) for k, n in POINTS.items()}
# The page draws a vertex per face corner, in the mesh's corner order: each point's first corner there.
corner = {k: next(l.index for l in head.data.loops if l.vertex_index == v) for k, v in vertex.items()}
# The neck seam: the head's open-edge vertices that touch the body at the first frame (within 2 mm of a body vertex), each
# paired with that body vertex; the seam's gap is the widest pair at each frame.
from collections import Counter
scene.frame_set(frames[0])
p0, b0 = positions(), positions(body)
edges = Counter(tuple(sorted(e)) for poly in head.data.polygons for e in poly.edge_keys)
open_vertices = sorted({v for e, n in edges.items() if n == 1 for v in e})
from mathutils.kdtree import KDTree
tree = KDTree(len(b0))
for i, co in enumerate(b0):
    tree.insert(co, i)
tree.balance()
pairs = [(v, tree.find(p0[v])[1]) for v in open_vertices if tree.find(p0[v])[2] < 0.002]
first_corner = lambda mesh, v: next(l.index for l in mesh.loops if l.vertex_index == v)
seam = {'head': [first_corner(head.data, h) for h, _ in pairs], 'body': [first_corner(body.data, b) for _, b in pairs]}
rows = []
for f in frames:
    scene.frame_set(f)
    p = positions()
    b = positions(body)
    local = head.matrix_world.inverted()
    rows.append({'frame': f, 'mouth': (p[vertex['lower']] - p[vertex['upper']]).length, 'jaw': (p[vertex['chin']] - p[vertex['nose']]).length,
                 'local': {k: list(local @ p[v]) for k, v in vertex.items()}, 'seam': [(b[j] - p[i]).length for i, j in pairs]})
print('ACTING ' + json.dumps({'vertex': vertex, 'corner': corner, 'seam': seam, 'rows': rows}))
