# Writes the fixtures of Blender's import and export add-ons (tests/fixtures/io-addons/): Blender's Suzanne scene
# (tests/fixtures/io/suzanne.blend) exported by the glTF 2.0 add-on as .glb and as .gltf with its .bin, a walking
# armature exported as Motion Capture (.bvh), and an SVG; then each imported by Blender's add-on into an empty scene,
# with what the import made (io-addons.json, io_addon_summary.py), and Blender's FBX (Legacy) import of suzanne.fbx.
# usage: blender -b --factory-startup --python tools/blender-reference/io-addon-fixtures.py -- OUT_DIR
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_addon_summary import summary  # noqa: E402

out = sys.argv[sys.argv.index("--") + 1]
io = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tests", "fixtures", "io")
os.makedirs(out, exist_ok=True)
SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect x="10" y="10" width="60" height="40" fill="#e05030"/>
  <circle cx="120" cy="40" r="25" fill="#3080e0"/>
  <path d="M 20 90 C 60 60, 100 120, 180 80" stroke="#202020" fill="none"/>
</svg>
"""


def empty_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def walking_armature():
    """Three bones in a chain whose root moves and whose bones bend over frames 1 to 20."""
    data = bpy.data.armatures.new("Walker")
    ob = bpy.data.objects.new("Walker", data)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    parent = None
    for i, name in enumerate(["Hip", "Knee", "Foot"]):
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = (0, 0, 2 - i * 0.8), (0, 0, 1.2 - i * 0.8)
        bone.parent, bone.use_connect = parent, parent is not None
        parent = bone
    bpy.ops.object.mode_set(mode="POSE")
    for frame, (x, bend) in {1: (0.0, 0.0), 10: (0.5, 30.0), 20: (1.0, -20.0)}.items():
        ob.pose.bones["Hip"].location = (x, 0, 0)
        ob.pose.bones["Hip"].keyframe_insert("location", frame=frame)
        for name in ("Knee", "Foot"):
            ob.pose.bones[name].rotation_mode = "XYZ"
            ob.pose.bones[name].rotation_euler = (math.radians(bend), 0, 0)
            ob.pose.bones[name].keyframe_insert("rotation_euler", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def imported(run):
    empty_scene()
    run()
    return summary()


bpy.ops.wm.open_mainfile(filepath=os.path.join(io, "suzanne.blend"))
for ob in bpy.context.scene.objects:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "suzanne.glb"), export_format="GLB")
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "suzanne.gltf"), export_format="GLTF_SEPARATE")
empty_scene()
walking_armature()
bpy.ops.export_anim.bvh(filepath=os.path.join(out, "walk.bvh"), frame_start=1, frame_end=20)
open(os.path.join(out, "shapes.svg"), "w").write(SVG)

reference = {
    "glb": imported(lambda: bpy.ops.import_scene.gltf(filepath=os.path.join(out, "suzanne.glb"))),
    "gltf": imported(lambda: bpy.ops.import_scene.gltf(filepath=os.path.join(out, "suzanne.gltf"))),
    "fbx_legacy": imported(lambda: bpy.ops.import_scene.fbx(filepath=os.path.join(io, "suzanne.fbx"))),
    "bvh": imported(lambda: bpy.ops.import_anim.bvh(filepath=os.path.join(out, "walk.bvh"))),
    "svg": imported(lambda: bpy.ops.import_curve.svg(filepath=os.path.join(out, "shapes.svg"))),
}
json.dump(reference, open(os.path.join(out, "io-addons.json"), "w"), indent=1)
print("wrote", out)
