# Writes tests/fixtures/objects/instanced-slots.blend: a cube of two material slots (Red on its top, Blue elsewhere) in a
# collection that two empties instance, the source collection excluded from the view layer.
# usage: blender -b --factory-startup --python tools/blender-reference/instanced-slots-fixture.py -- OUT_FILE
import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
props = bpy.data.collections.new("Props")
scene.collection.children.link(props)
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.object
for collection in cube.users_collection:
    collection.objects.unlink(cube)
props.objects.link(cube)
for name, color in (("Blue", (0, 0, 1, 1)), ("Red", (1, 0, 0, 1))):
    material = bpy.data.materials.new(name)
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    cube.data.materials.append(material)
for polygon in cube.data.polygons:
    polygon.material_index = 1 if polygon.normal.z > 0.5 else 0
bpy.context.view_layer.layer_collection.children["Props"].exclude = True
for x in (-2, 2):
    empty = bpy.data.objects.new(f"Instance {x}", None)
    empty.instance_type, empty.instance_collection, empty.location = "COLLECTION", props, (x, 0, 0)
    scene.collection.objects.link(empty)
bpy.ops.wm.save_as_mainfile(filepath=out)
