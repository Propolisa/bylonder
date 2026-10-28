# Writes what Blender's textures give as fixtures (tests/fixtures/textures.json): Texture.evaluate at fixed points, and
# the evaluated UV sphere under a Displace modifier with the texture (after a Subdivision Surface where a case has one),
# with the settings by RNA identifier, and the sphere itself in Blender's element order (positions, edges, faces and
# their corners' vertices and edges).
# usage: blender -b --factory-startup --python tools/blender-reference/texture-fixtures.py -- OUT.json
import bpy, json, sys

out_path = sys.argv[sys.argv.index("--") + 1]
CLOUDS = {"type": "CLOUDS"}
TEXTURES = {
    "clouds": CLOUDS,
    "clouds-depth-0": {**CLOUDS, "noise_depth": 0},
    "clouds-depth-6": {**CLOUDS, "noise_depth": 6, "noise_scale": 0.5},
    "clouds-hard": {**CLOUDS, "noise_type": "HARD_NOISE", "noise_scale": 0.4},
    "clouds-perlin": {**CLOUDS, "noise_basis": "IMPROVED_PERLIN", "noise_depth": 3, "noise_scale": 0.8},
    "clouds-voronoi": {**CLOUDS, "noise_basis": "VORONOI_F2_F1", "noise_scale": 0.6},
    "clouds-color": {**CLOUDS, "cloud_type": "COLOR", "noise_depth": 4},
    "clouds-adjusted": {**CLOUDS, "intensity": 1.2, "contrast": 1.5, "saturation": 0.8},
}
POINTS = [(0.0, 0.0, 0.0), (0.3, -0.7, 0.2), (1.0, 0.5, -0.25), (-2.1, 3.3, 0.9), (0.05, 0.05, 1.7)]
CASES = {
    "displace-clouds": ("clouds", {}, 0),
    "displace-depth-0": ("clouds-depth-0", {"strength": 0.5}, 0),
    "displace-depth-6": ("clouds-depth-6", {"strength": 0.3, "mid_level": 0.2}, 0),
    "displace-hard": ("clouds-hard", {"strength": -0.4}, 0),
    "displace-perlin-subsurf": ("clouds-perlin", {"strength": 0.25}, 1),
    "displace-voronoi-subsurf": ("clouds-voronoi", {"strength": 0.2, "mid_level": 0.0}, 1),
    "displace-color-rgb": ("clouds-color", {"direction": "RGB_TO_XYZ", "strength": 0.3}, 0),
    "displace-global-z": ("clouds", {"direction": "Z", "texture_coords": "GLOBAL", "strength": 0.6}, 1),
}


def texture(name):
    tex = bpy.data.textures.new(name, TEXTURES[name]["type"])
    for key, value in TEXTURES[name].items():
        if key != "type":
            setattr(tex, key, value)
    return tex


r = lambda v: [round(x, 6) for x in v]
samples = {name: [r(texture(name).evaluate(p)) for p in POINTS] for name in TEXTURES}
cases = {}
for name, (tex_name, values, levels) in CASES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_uv_sphere_add()
    ob = bpy.context.object
    stack = []
    if levels:
        ob.modifiers.new("Subdivision", "SUBSURF").levels = levels
        stack.append({"type": "SUBSURF", "values": {"levels": levels}})
    md = ob.modifiers.new("Displace", "DISPLACE")
    md.texture = texture(tex_name)
    for key, value in values.items():
        setattr(md, key, value)
    stack.append({"type": "DISPLACE", "values": values, "texture": tex_name})
    me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    cases[name] = {"stack": stack, "positions": [r(v.co) for v in me.vertices]}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add()
me = bpy.context.object.data
sphere = {"positions": [r(v.co) for v in me.vertices], "edges": [list(e.vertices) for e in me.edges],
          "face_offsets": [p.loop_start for p in me.polygons] + [len(me.loops)], "corner_verts": [l.vertex_index for l in me.loops],
          "corner_edges": [l.edge_index for l in me.loops]}
json.dump({"blender": bpy.app.version_string, "sphere": sphere, "textures": TEXTURES, "points": POINTS, "samples": samples, "cases": cases},
          open(out_path, "w"), separators=(",", ":"))
print("wrote", out_path, len(samples), "textures,", len(cases), "cases")
