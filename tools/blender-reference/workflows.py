"""Common Blender session work as bpy does it in Blender 5.2.3, from the default file: each workflow's steps, then the
scene's state (state(), which tests/e2e/workflows.mjs reads the same way from Bylonder's RNA after doing the same
steps as a user does in Bylonder). Writes tests/fixtures/workflows.json.
usage: blender -b --factory-startup --python tools/blender-reference/workflows.py"""
import json
import math
import os

import bmesh
import bpy
from bpy_extras import anim_utils

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
DIGITS = 4


def rounded(values):
    return [round(v, DIGITS) + 0.0 for v in values]


def state():
    """The scene as the workflows compare it: objects by name, with their transforms, parents, modifiers, materials,
    mesh sizes and animation; collections with their objects. The same paths tests/e2e/workflows.mjs reads."""
    objects = {}
    for ob in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        entry = {
            'type': ob.type,
            'location': rounded(ob.location),
            'rotation_euler': rounded(ob.rotation_euler),
            'scale': rounded(ob.scale),
            'parent': ob.parent.name if ob.parent else None,
            'hide_viewport': ob.hide_get(),
            'modifiers': [[m.name, m.type] for m in ob.modifiers],
            'materials': [slot.material.name if slot.material else None for slot in ob.material_slots],
        }
        if ob.type == 'MESH':
            mesh = ob.data
            coords = [v.co for v in mesh.vertices]
            entry['mesh'] = {'vertices': len(mesh.vertices), 'edges': len(mesh.edges), 'faces': len(mesh.polygons),
                             'bounds': [rounded(min(c[i] for c in coords) for i in range(3)), rounded(max(c[i] for c in coords) for i in range(3))]}
        action = ob.animation_data.action if ob.animation_data else None
        if action:
            # A layered action's F-Curves, in the object's slot (Blender 5).
            bag = anim_utils.action_get_channelbag_for_slot(action, ob.animation_data.action_slot)
            entry['keys'] = {curve.data_path + f'[{curve.array_index}]': [rounded(k.co) for k in curve.keyframe_points] for curve in bag.fcurves}
        objects[ob.name] = entry
    materials = {}
    for ma in sorted(bpy.data.materials, key=lambda m: m.name):
        if not ma.users:
            continue
        bsdf = ma.node_tree.nodes.get('Principled BSDF') if ma.node_tree else None
        materials[ma.name] = {'base_color': rounded(bsdf.inputs['Base Color'].default_value) if bsdf else None}
    collections = {c.name: sorted(o.name for o in c.objects) for c in bpy.context.scene.collection.children_recursive}
    return {'objects': objects, 'materials': materials, 'collections': collections, 'frame': bpy.context.scene.frame_current}


def select(*names):
    bpy.ops.object.select_all(action='DESELECT')
    for name in names:
        bpy.data.objects[name].select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects[names[-1]]


# Each workflow from the default file (Cube selected and active), as the operators a user's keys and menus run.
def block_out():
    """Shift A > Mesh > UV Sphere, G X 3, S 0.5; Shift A > Mesh > Cylinder, G Y -3, R Z 45; X deletes the Light."""
    bpy.ops.mesh.primitive_uv_sphere_add()
    bpy.ops.transform.translate(value=(3, 0, 0), constraint_axis=(True, False, False))
    bpy.ops.transform.resize(value=(0.5, 0.5, 0.5))
    bpy.ops.mesh.primitive_cylinder_add()
    bpy.ops.transform.translate(value=(0, -3, 0), constraint_axis=(False, True, False))
    bpy.ops.transform.rotate(value=math.radians(45), orient_axis='Z')
    select('Light')
    bpy.ops.object.delete()


def edit_model():
    """Tab, 3 (face select), click the top face, I 0.2, E 1, G Z 0.5; Tab; Ctrl 2 (Subdivision Surface level 2); Shade
    Smooth."""
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(bpy.context.object.data)
    next(f for f in bm.faces if f.normal.z > 0.9).select_set(True)
    bmesh.update_edit_mesh(bpy.context.object.data)
    bpy.ops.mesh.inset(thickness=0.2)
    bpy.ops.mesh.extrude_region_move(TRANSFORM_OT_translate={'value': (0, 0, 1), 'orient_type': 'NORMAL', 'constraint_axis': (False, False, True)})
    bpy.ops.transform.translate(value=(0, 0, 0.5), constraint_axis=(False, False, True))
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.subdivision_set(level=2, relative=False)
    bpy.ops.object.shade_smooth()


def organize():
    """Shift A > Mesh > Monkey; Shift D, G X 3; M > New Collection "Props"; the Monkey parented to the Cube (Ctrl P);
    the duplicate hidden (H)."""
    bpy.ops.mesh.primitive_monkey_add(location=(0, 3, 0))
    bpy.ops.object.duplicate_move(TRANSFORM_OT_translate={'value': (3, 0, 0)})
    bpy.ops.object.move_to_collection(collection_uid=bpy.context.scene.collection.session_uid, is_new=True, new_collection_name='Props')
    select('Suzanne', 'Cube')
    bpy.ops.object.parent_set(type='OBJECT')
    # H (object.hide_view_set) on the selection, which needs a 3D Viewport: hides it as the operator does.
    bpy.data.objects['Suzanne.001'].hide_set(True)


def animate():
    """I on frame 1, frame 30 (typed in the Timeline), G Z 2, I."""
    # I (anim.keyframe_insert, which needs a 3D Viewport) keys the channels the Preferences name: Location, Rotation, Scale.
    def insert():
        for path in ('location', 'rotation_euler', 'scale'):
            bpy.context.object.keyframe_insert(path)
    bpy.context.scene.frame_set(1)
    insert()
    bpy.context.scene.frame_set(30)
    bpy.ops.transform.translate(value=(0, 0, 2), constraint_axis=(False, False, True))
    insert()


def material():
    """Material properties > New, Base Color red (0.8, 0.05, 0.05)."""
    ob = bpy.context.object
    bpy.ops.material.new()
    ma = bpy.data.materials[-1]
    ob.data.materials.clear()
    ob.data.materials.append(ma)
    ma.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.05, 0.05, 1)


WORKFLOWS = {'block-out': block_out, 'edit-model': edit_model, 'organize': organize, 'animate': animate, 'material': material}


def main():
    results = {}
    for name, steps in WORKFLOWS.items():
        bpy.ops.wm.read_homefile(use_factory_startup=True)
        steps()
        results[name] = state()
    path = os.path.join(ROOT, 'tests', 'fixtures', 'workflows.json')
    with open(path, 'w') as f:
        json.dump(results, f, indent=1, sort_keys=True)
    print('wrote', path)


main()
