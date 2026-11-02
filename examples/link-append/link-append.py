"""Link and Append: a library, libraries/library.blend, with a collection (Props: a crate and a ball with their
materials), a lamp post outside it and a material no object uses (Gold); then the Default Cube's scene, the cube deleted,
with Props linked (an empty instancing the collection) and made a library override, and the lamp post appended: the
scene File > Link, File > Append and Object > Library Override > Make make from it.

blender -b --factory-startup -P link-append.py   (writes libraries/library.blend and link-append.blend beside this file)

The library is at /libraries/library.blend in Bylonder's file system, where a project keeps its libraries.
"""
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY = os.path.join(HERE, "libraries", "library.blend")


def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
props = bpy.data.collections.new("Props")
bpy.context.scene.collection.children.link(props)
bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children["Props"]
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(1.0, 0.0, 0.5))
bpy.context.object.name = "Crate"
bpy.context.object.data.materials.append(material("Wood", (0.6, 0.4, 0.2, 1.0)))
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(-1.0, 0.0, 0.5), rotation=(0.0, 0.0, 0.4))
bpy.context.object.name = "Ball"
bpy.ops.object.shade_smooth()
bpy.context.object.data.materials.append(material("Rubber", (0.8, 0.1, 0.1, 1.0)))
bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection
bpy.ops.mesh.primitive_cylinder_add(radius=0.1, depth=3.0, location=(0.0, 3.0, 1.5))
bpy.context.object.name = "Lamp Post"
material("Gold", (1.0, 0.8, 0.2, 1.0)).use_fake_user = True
os.makedirs(os.path.dirname(LIBRARY), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=LIBRARY)

bpy.ops.wm.read_factory_settings()
bpy.data.objects.remove(bpy.data.objects["Cube"])
bpy.ops.wm.link(directory=os.path.join(LIBRARY, "Collection") + "/", filename="Props", files=[{"name": "Props"}])
bpy.context.view_layer.objects.active = bpy.data.objects["Props"]
bpy.ops.object.make_override_library()
bpy.ops.wm.append(directory=os.path.join(LIBRARY, "Object") + "/", filename="Lamp Post", files=[{"name": "Lamp Post"}])
bpy.data.libraries["library.blend"].filepath = "/libraries/library.blend"
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "link-append.blend"), compress=True, relative_remap=False)
