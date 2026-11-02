"""Import and Export: Suzanne with a UV map, a color attribute, smooth shading and a material, written by Blender 5.2's
OBJ exporter (suzanne.obj, suzanne.mtl) and read back by its importer into the Default Cube's scene, the cube deleted:
the scene File > Import > Wavefront (.obj) makes from these files.

blender -b --factory-startup -P import-export.py   (writes the files and import-export.blend beside this file)
"""
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OBJ = os.path.join(HERE, "suzanne.obj")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_monkey_add()
suzanne = bpy.context.object
suzanne.name = "Suzanne"
mesh = suzanne.data
colors = mesh.color_attributes.new("Col", "BYTE_COLOR", "POINT")
for i, value in enumerate(colors.data):
    value.color = ((i % 7) / 6, (i % 5) / 4, (i % 3) / 2, 1.0)
bpy.ops.object.shade_smooth()
material = bpy.data.materials.new("Skin")
material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.3, 0.2, 1.0)
mesh.materials.append(material)
bpy.ops.wm.obj_export(filepath=OBJ, export_colors=True)

bpy.ops.wm.read_factory_settings()
bpy.data.objects.remove(bpy.data.objects["Cube"])
bpy.ops.wm.obj_import(filepath=OBJ)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "import-export.blend"), compress=True)
