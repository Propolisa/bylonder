# A small add-on: Edit > Preferences > Add-ons > Install from Disk with this file, then enable it. It adds Object >
# Scatter Cubes, the same entry in Shift A, a Scatter tab in the 3D Viewport's sidebar (N) and Ctrl Shift R.
bl_info = {
    "name": "Scatter Cubes",
    "author": "Bylonder",
    "version": (1, 0),
    "blender": (5, 2, 0),
    "location": "View3D > Add > Scatter Cubes, Sidebar > Scatter",
    "description": "Adds cubes at random places around the 3D cursor",
    "category": "Object",
}

import random

import bpy

addon_keymaps = []


class OBJECT_OT_scatter_cubes(bpy.types.Operator):
    """Add cubes at random places around the 3D cursor"""

    bl_idname = "object.scatter_cubes"
    bl_label = "Scatter Cubes"
    bl_options = {'REGISTER', 'UNDO'}

    count: bpy.props.IntProperty(name="Count", default=10, min=1, max=200)
    radius: bpy.props.FloatProperty(name="Radius", default=4.0, min=0.1, unit='LENGTH')
    seed: bpy.props.IntProperty(name="Seed", default=0)

    def execute(self, context):
        rng = random.Random(self.seed)
        cx, cy, cz = context.scene.cursor.location
        for _ in range(self.count):
            location = (cx + rng.uniform(-self.radius, self.radius), cy + rng.uniform(-self.radius, self.radius), cz)
            bpy.ops.mesh.primitive_cube_add(size=rng.uniform(0.2, 0.8), location=location)
        self.report({'INFO'}, f"Added {self.count} cubes")
        return {'FINISHED'}


class VIEW3D_PT_scatter_cubes(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Scatter"
    bl_label = "Scatter Cubes"

    def draw(self, context):
        self.layout.operator(OBJECT_OT_scatter_cubes.bl_idname, icon='MESH_CUBE')


def menu(self, context):
    self.layout.operator(OBJECT_OT_scatter_cubes.bl_idname, icon='MESH_CUBE')


def register():
    bpy.utils.register_class(OBJECT_OT_scatter_cubes)
    bpy.utils.register_class(VIEW3D_PT_scatter_cubes)
    bpy.types.VIEW3D_MT_object.append(menu)
    bpy.types.VIEW3D_MT_add.append(menu)
    keyconfig = bpy.context.window_manager.keyconfigs.addon
    if keyconfig:
        keymap = keyconfig.keymaps.new(name="Object Mode", space_type='EMPTY')
        addon_keymaps.append((keymap, keymap.keymap_items.new(OBJECT_OT_scatter_cubes.bl_idname, 'R', 'PRESS', ctrl=True, shift=True)))


def unregister():
    for keymap, item in addon_keymaps:
        keymap.keymap_items.remove(item)
    addon_keymaps.clear()
    bpy.types.VIEW3D_MT_add.remove(menu)
    bpy.types.VIEW3D_MT_object.remove(menu)
    bpy.utils.unregister_class(VIEW3D_PT_scatter_cubes)
    bpy.utils.unregister_class(OBJECT_OT_scatter_cubes)
