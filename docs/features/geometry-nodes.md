---
id: geometry-nodes
title: Geometry Nodes
summary: Build a Geometry Nodes modifier from an empty node group, expose its inputs, make node groups, and see the evaluated mesh, points and instances drawn.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/modifiers/generate/geometry_nodes.html
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/instances.html
  - https://docs.blender.org/manual/en/5.2/interface/controls/nodes/groups.html
example: geometry-nodes
thumbnail: geometry-nodes/thumbnail.png
media:
  - geometry-nodes/grid.gif
  - geometry-nodes/modifier.gif
  - geometry-nodes/workspace.gif
  - geometry-nodes/points.gif
  - geometry-nodes/instances.gif
  - geometry-nodes/input.gif
  - geometry-nodes/group.gif
ui:
  - GeometryNodeTree
  - NODE_EDITOR
  - NODE_MT_add
  - OBJECT_MT_modifier_add
  - PROPERTIES
  - VIEW_3D
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

The demo is the Geometry Nodes Meadow example, made by `geometry-nodes.mjs`: a grid whose Scatter group distributes
points, stores a random `height` on each, and instances a Tree group scaled by it. The steps below build its start from
the Default Cube's scene.

## Steps

1. **Add a grid.** Hover the 3D Viewport, press Delete to delete the cube, then Add > Mesh > Grid.

   ![Delete deletes the cube, Add > Mesh > Grid](../media/features/geometry-nodes/grid.gif)

2. **Add the modifier.** In Properties > Modifiers, Add Modifier > Geometry Nodes, then New. The new group passes the
   grid through.

   ![Add Modifier > Geometry Nodes, New](../media/features/geometry-nodes/modifier.gif)

3. **Open the Geometry Nodes workspace.** Its Geometry Node Editor shows the modifier's group, with the Spreadsheet
   and the 3D Viewport above it.

   ![The Geometry Nodes tab](../media/features/geometry-nodes/workspace.gif)

4. **Distribute points.** Over the editor, press Shift A, type Distribute, press Enter and click to place the node.
   Drag from Group Input's Geometry to its Mesh, and from its Points to Group Output. The grid becomes a point cloud,
   each point drawn at its radius.

   ![Distribute Points on Faces, linked](../media/features/geometry-nodes/points.gif)

5. **Instance on the points.** Add Instance on Points and Cone the same way, link the points and the cone into it and
   its Instances to Group Output. A cone stands on every point.

   ![Instance on Points with a Cone](../media/features/geometry-nodes/instances.gif)

6. **Expose an input.** Drag from Group Input's empty socket to Distribute Points on Faces' Density. The group gains a
   Density input, which Properties > Modifiers shows on the modifier; change it there.

   ![Density as the modifier's input](../media/features/geometry-nodes/input.gif)

7. **Make a group.** Click the Cone node and press Ctrl G: it becomes a group node. Tab enters the group, Ctrl Tab
   leaves it, and Ctrl Alt G ungroups.

   ![Ctrl G, Tab, Ctrl Tab](../media/features/geometry-nodes/group.gif)

The [Spreadsheet](spreadsheet.md) lists what the modifier made, component by component.

## Project files

- [geometry-nodes.mjs](../../examples/geometry-nodes/geometry-nodes.mjs) and
  [geometry-nodes.blend](../../examples/geometry-nodes/geometry-nodes.blend): the Meadow, its Scatter and Tree groups.
- Recorded by [record-geometry-nodes.mjs](../../tools/docs/record-geometry-nodes.mjs).
