---
id: geometry-nodes
title: Geometry Nodes
summary: Build a Geometry Nodes modifier from an empty node group, shape a mesh, instance objects on points, expose inputs, and see the evaluated mesh, points and instances drawn.
expect: Meshes, points and mesh instances evaluate and draw as in Blender; volumes and instanced curves are not drawn, and instances take their mesh's first material.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/modifiers/geometry_nodes.html
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/instances.html
  - https://docs.blender.org/manual/en/5.2/interface/controls/nodes/groups.html
example: geometry-nodes
thumbnail: geometry-nodes/thumbnail.png
media:
  - geometry-nodes/sphere.gif
  - geometry-nodes/modifier.gif
  - geometry-nodes/workspace.gif
  - geometry-nodes/terrain.gif
  - geometry-nodes/forest.gif
  - geometry-nodes/input.gif
  - geometry-nodes/planet-tree.png
ui:
  - GeometryNodeTree
  - NODE_EDITOR
  - PROPERTIES
  - VIEW_3D
  - OBJECT_MT_modifier_add*
  - DATA_PT_modifiers
  - NODE_MT_add
  - NODE_MT_geometry*
  - NODE_MT_group*
  - NODE_PT_geometry*
operators:
  - object.modifier_add
  - node.new_geometry_node_group_assign
  - node.add_node
  - node.link
  - node.group_make
  - node.group_edit
  - node.group_ungroup
code:
  - src/editors/space_node/main-node-tree.js
  - src/editors/space_node/node-editor-controller.js
  - src/blenkernel/main-view.js
  - src/draw/pointcloud.js
  - tools/blender-port/wasm/main-api.cc
tests:
  - tests/spreadsheet-wasm.test.js
  - tests/geometry-node-editor.test.js
  - tests/instances-wasm.test.js
limits:
  - Volumes are evaluated but not drawn; curves draw as the hair curves do.
  - Instances draw where their geometry is a mesh, an object or a point cloud; instanced curves and volumes do not.
  - Instance attributes (a color per instance) do not reach the material yet: an instance draws in its mesh's first material.
  - Points are spheres in their material in every shading mode; Solid does not give them Workbench's studio light yet.
  - The Node Editor's header has View only; its Select, Add and Node menus are reached by their keys (Shift A adds).
  - The sidebar's Group tab (the interface panels and their sockets' settings) is not shown yet.
---
# Geometry Nodes

A Geometry Nodes modifier evaluates a node group on its object's geometry. The tree is Blender's, held in Main and
evaluated by Blender's geometry nodes in the module; the Geometry Node Editor edits it with Blender's own API and
operators (see [Geometry Node Editor](geometry-node-editor.md)). The view draws what the evaluation made: the mesh,
point clouds and instances: every instance of one mesh is a Babylon thin instance of a single mesh, and every point a
camera-facing quad drawn as a sphere of its radius.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=geometry-nodes)

The demo is a tiny planet whose terrain, sea, forests and clouds all come from one modifier on an ico sphere
(`geometry-nodes.py`). The steps below build its core from the Default Cube's scene: terrain lifted along the normals
by noise, and trees instanced on points that stand on the ground.

## Steps

1. **Add a sphere.** Hover the 3D Viewport, press Delete, then Add > Mesh > Ico Sphere. In the Adjust Last Operation
   panel set Subdivisions to 6, enough faces for the noise to shape.

   ![Delete, Add > Mesh > Ico Sphere, Subdivisions 6](../media/features/geometry-nodes/sphere.gif)

2. **Add the modifier.** In Properties > Modifiers, Add Modifier > Geometry Nodes, then New. The new group passes the
   sphere through.

   ![Add Modifier > Geometry Nodes, New](../media/features/geometry-nodes/modifier.gif)

3. **Open the Geometry Nodes workspace.** Its Geometry Node Editor shows the modifier's group, with the Spreadsheet
   and the 3D Viewport above it.

   ![The Geometry Nodes tab](../media/features/geometry-nodes/workspace.gif)

4. **Lift the terrain.** Over the editor, Shift A and type to add Set Position between Group Input and Group Output.
   Add Noise Texture, Math (Multiply), Normal and Vector Math (Scale): the noise, times 0.25, scales the normal, and
   that is Set Position's Offset. Every vertex moves out along its normal by the noise at its position.

   ![Set Position with an Offset of Normal scaled by Noise](../media/features/geometry-nodes/terrain.gif)

5. **Grow a forest.** Add Distribute Points on Faces on the terrain (Density 80), Instance on Points with a small
   Cone as the instance, and Join Geometry to keep the terrain with the trees. Linking the points' Rotation into
   Instance on Points stands each cone on the surface, along its normal.

   ![Distribute Points on Faces, Instance on Points, Join Geometry](../media/features/geometry-nodes/forest.gif)

6. **Expose an input.** Drag from Group Input's empty socket to Noise Texture's Scale. The group gains a Scale input,
   which Properties > Modifiers shows on the modifier: a smaller scale makes larger continents.

   ![Noise Scale as the modifier's input](../media/features/geometry-nodes/input.gif)

7. **The planet.** The example adds to the same pattern in frames: the height is stored as an attribute the terrain
   material colors by (sand, meadow, forest, rock, snow), land below Sea Level sinks under a smooth sea sphere,
   forests pick one of four tree objects from a collection where a second noise says woods, and clouds are points on a
   larger sphere, their radius following a noise.

   ![The Planet group, in its Terrain, Sea, Forests and Clouds frames](../media/features/geometry-nodes/planet-tree.png)

The [Spreadsheet](spreadsheet.md) lists what the modifier made, component by component.

## Project files

- [geometry-nodes.py](../../examples/geometry-nodes/geometry-nodes.py): builds the planet, its node group, materials,
  trees, sun and camera in Blender 5.2.
- [geometry-nodes.blend](../../examples/geometry-nodes/geometry-nodes.blend): the file the script saves.
- Recorded by [record-geometry-nodes.mjs](../../tools/docs/record-geometry-nodes.mjs).
