# Run Script (Alt P) in the Text Editor: a grid mesh whose vertices numpy lifts into a wave, written in one
# foreach_set, as add-ons move large data in Blender.
import bpy
import numpy as np

bpy.ops.mesh.primitive_grid_add(x_subdivisions=64, y_subdivisions=64, size=6, location=(0, 0, 1.5))
mesh = bpy.context.object.data

co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
mesh.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
radius = np.hypot(co[:, 0], co[:, 1])
co[:, 2] = 0.25 * np.sin(radius * 3.0) / (1.0 + radius)
mesh.vertices.foreach_set("co", co.ravel())
mesh.update()

print(f"{len(co)} vertices, height {co[:, 2].min():.2f} to {co[:, 2].max():.2f}")
