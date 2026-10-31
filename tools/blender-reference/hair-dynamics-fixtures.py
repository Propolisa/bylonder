# Writes Blender's Hair Dynamics simulation as a fixture (tests/fixtures/hair-dynamics.json): hair added to a monkey by
# its Add operator (which adds Hair Dynamics from the Essentials library), Generate Hair Curves added from there above
# it, inputs set by identifier, and the evaluated control point positions at frames played from the start, as
# tests/hair-dynamics.test.js replays them.
# usage: blender -b --factory-startup --python tools/blender-reference/hair-dynamics-fixtures.py -- OUT_FILE
import bpy, json, sys

out_file = sys.argv[sys.argv.index("--") + 1]

GENERATE = "Generate Hair Curves"
CASE = {
    "operators": [
        ["mesh.primitive_monkey_add", {"size": 2}],
        ["object.curves_empty_hair_add", {}],
        ["object.modifier_add_node_group", {"asset_library_type": "ESSENTIALS",
                                            "relative_asset_identifier": f"nodes/procedural_hair_node_assets.blend/NodeTree/{GENERATE}"}],
        ["object.modifier_move_to_index", {"modifier": GENERATE, "index": 0}],
    ],
    # By modifier: Surface, Length, Density and Control Points; Mode.
    "inputs": {GENERATE: {"Input_2": "Suzanne", "Input_20": 0.6, "Input_15": 40.0, "Input_27": 6},
               "Hair Dynamics": {"Socket_44": "Physics (Experimental)"}},
    "frames": [1, 2, 5, 10, 20],
}

bpy.ops.wm.read_factory_settings(use_empty=True)
for idname, props in CASE["operators"]:
    category, name = idname.split(".")
    getattr(getattr(bpy.ops, category), name)(**props)
hair = bpy.context.object
for modifier, inputs in CASE["inputs"].items():
    for identifier, value in inputs.items():
        getattr(hair.modifiers[modifier].properties.inputs, identifier).value = bpy.data.objects.get(value, value) if isinstance(value, str) else value
hair.update_tag()

frames = {}
for frame in range(1, CASE["frames"][-1] + 1):
    bpy.context.scene.frame_set(frame)
    if frame in CASE["frames"]:
        curves = hair.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
        frames[frame] = {"curves": len(curves.curves), "positions": [round(c, 5) for p in curves.points for c in p.position]}

with open(out_file, "w") as f:
    json.dump({"case": CASE, "frames": frames}, f, separators=(",", ":"))
