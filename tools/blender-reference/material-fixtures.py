# Writes what Blender's glTF exporter (io_scene_gltf2) makes of Principled BSDF materials as fixtures
# (tests/fixtures/materials-gltf.json): each case's Principled inputs and settings as set, and the glTF material the
# exporter writes for it.
# usage: blender -b --factory-startup --python tools/blender-reference/material-fixtures.py -- OUT.json
import bpy, json, os, sys, tempfile

out_path = sys.argv[sys.argv.index("--") + 1]
CASES = {
    "default": ({}, {}),
    "red": ({"Base Color": (0.8, 0.1, 0.1, 1.0), "Metallic": 0.2, "Roughness": 0.4}, {}),
    "glow": ({"Emission Color": (1.0, 0.5, 0.2, 1.0), "Emission Strength": 3.0, "Alpha": 0.5}, {"use_backface_culling": True}),
    "dim-glow": ({"Base Color": (0.1, 0.2, 0.3, 1.0), "Emission Color": (0.2, 0.4, 0.6, 1.0), "Emission Strength": 0.5}, {}),
    "layers": ({"Coat Weight": 0.7, "Coat Roughness": 0.2, "Sheen Weight": 0.5, "Sheen Tint": (0.3, 0.4, 0.5, 1.0),
                "Sheen Roughness": 0.6, "Specular IOR Level": 0.25, "Specular Tint": (0.9, 0.8, 0.7, 1.0), "IOR": 1.45,
                "Transmission Weight": 0.3}, {}),
    "bright-specular": ({"Specular IOR Level": 0.8, "Specular Tint": (0.5, 1.0, 1.0, 1.0), "Metallic": 1.0, "Roughness": 0.1}, {}),
    "clear": ({"Alpha": 0.0}, {}),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
cases = {}
for index, (name, (inputs, settings)) in enumerate(CASES.items()):
    bpy.ops.mesh.primitive_cube_add(location=(index * 3, 0, 0))
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    for key, value in inputs.items():
        principled.inputs[key].default_value = value
    for key, value in settings.items():
        setattr(material, key, value)
    bpy.context.object.data.materials.append(material)
    cases[name] = {
        "inputs": {s.identifier: (list(s.default_value) if hasattr(s.default_value, "__len__") else s.default_value)
                   for s in principled.inputs if hasattr(s, "default_value")},
        "use_backface_culling": material.use_backface_culling,
    }

path = os.path.join(tempfile.mkdtemp(), "materials.gltf")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE")
for material in json.load(open(path))["materials"]:
    cases[material.pop("name")]["gltf"] = material
json.dump(cases, open(out_path, "w"), indent=1, sort_keys=True)
