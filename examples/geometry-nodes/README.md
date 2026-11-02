# Geometry Nodes

A meadow scattered with trees by a Geometry Nodes modifier, made by `geometry-nodes.mjs` with Blender's own code in
Bylonder's module (`node examples/geometry-nodes/geometry-nodes.mjs`) and opened here with Blender's reader.

- **Scatter.** The Meadow's modifier distributes points on the grid, stores a random `height` on each as a named
  attribute, and instances the Tree node group on every point, scaled by `height` times Scale. The points stay in the
  result as a point cloud.
- **Inputs.** Properties > Modifiers shows the group's Density, Scale and Seed.
- **Inspecting.** The Geometry Nodes workspace's Spreadsheet lists the evaluated mesh, point cloud and instances, with
  the `height` column on the points.
- **Groups.** Select the Tree node and press Tab to edit the group, Ctrl Tab to leave it.
