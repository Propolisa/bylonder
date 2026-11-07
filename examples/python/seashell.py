# Run Script (Alt P) in the Text Editor: a seashell built with numpy. The shell is a tube swept along a logarithmic
# spiral: as it turns, it grows by GROWTH per turn and slides down by DROP, so each whorl wraps the last. numpy computes
# every vertex at once and writes them in one foreach_set, with brown bands from a sine of the angle as a color
# attribute. Change TURNS, GROWTH or DROP and run it again: the shell is rebuilt.
import bpy
import numpy as np

TURNS, GROWTH, DROP = 5.5, 1.9, 1.15
AROUND, ALONG = 48, 360

collection = bpy.data.collections.get("Seashell") or bpy.data.collections.new("Seashell")
if collection.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(collection)
for ob in list(collection.objects):
    bpy.data.meshes.remove(ob.data)

theta = np.linspace(0, 2 * np.pi * TURNS, ALONG)[:, None]
phi = np.linspace(0, 2 * np.pi, AROUND, endpoint=False)[None]
scale = GROWTH ** (theta / (2 * np.pi) - TURNS)
# The tube's section: an ellipse with a flared lip, swept around the axis at the shell's growing radius.
radius = scale * (1.0 + 0.85 * np.cos(phi))
height = scale * (0.95 * np.sin(phi) - DROP * (theta / (2 * np.pi) - TURNS))
co = np.stack([radius * np.cos(theta), radius * np.sin(theta), height], -1).reshape(-1, 3)

rows, cols = np.meshgrid(np.arange(ALONG - 1), np.arange(AROUND), indexing="ij")
a = rows * AROUND + cols
b = rows * AROUND + (cols + 1) % AROUND
quads = np.stack([a, b, b + AROUND, a + AROUND], -1).reshape(-1, 4)

mesh = bpy.data.meshes.new("Seashell")
mesh.vertices.add(len(co))
mesh.vertices.foreach_set("co", co.astype(np.float32).ravel())
mesh.loops.add(quads.size)
mesh.loops.foreach_set("vertex_index", quads.ravel())
mesh.polygons.add(len(quads))
mesh.polygons.foreach_set("loop_start", np.arange(0, quads.size, 4))
mesh.polygons.foreach_set("use_smooth", np.ones(len(quads), bool))
mesh.update()

# Bands: dark where a sine of the angle (and a slower one) peaks, on a cream ground; pale inside the lip.
band = np.clip(np.sin(theta * 7.0) * 0.6 + np.sin(theta * 1.3) * 0.4, 0, 1) ** 2 * np.ones_like(phi)
inside = (np.cos(phi) < -0.3) * np.ones_like(theta)
cream, brown, pink = np.array([0.85, 0.72, 0.55]), np.array([0.25, 0.09, 0.03]), np.array([0.95, 0.6, 0.5])
color = cream + (brown - cream) * band[..., None]
color = np.where(inside[..., None] > 0, pink, color)
attribute = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
attribute.data.foreach_set("color", np.concatenate([color.reshape(-1, 3), np.ones((len(co), 1))], 1).astype(np.float32).ravel())

material = bpy.data.materials.get("Shell") or bpy.data.materials.new("Shell")
nodes = material.node_tree.nodes
if "Attribute" not in nodes:
    nodes.new("ShaderNodeAttribute").attribute_name = "Col"
    material.node_tree.links.new(nodes["Attribute"].outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.25
mesh.materials.append(material)

shell = bpy.data.objects.new("Seashell", mesh)
shell.location = (0, 0, 0.22)
shell.rotation_euler = (1.35, 0.15, 0.5)
shell.scale = (0.16,) * 3
collection.objects.link(shell)
bpy.context.view_layer.objects.active = shell
print(f"{len(co)} vertices, {TURNS} turns")
