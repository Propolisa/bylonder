---
id: geometry-node-editor
title: Geometry Node Editor
summary: Show and edit the node group of the active Geometry Nodes modifier: add nodes from Shift A's search, link sockets and set values, here to lay out a sunflower's seeds by the golden angle.
expect: Node groups open, edit and evaluate as in Blender; the sidebar's Group tab is missing, and Bylonder's own Geometry Nodes modifier opens in Babylon's editor instead.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/geometry_node.html
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/index.html
  - https://docs.blender.org/manual/en/5.2/interface/controls/nodes/editing.html
example: geometry-node-editor
thumbnail: geometry-node-editor/thumbnail.png
media:
  - geometry-node-editor/start.gif
  - geometry-node-editor/points.gif
  - geometry-node-editor/golden-angle.gif
  - geometry-node-editor/angle.gif
  - geometry-node-editor/seeds.gif
  - geometry-node-editor/sunflower-tree.png
ui:
  - GeometryNodeTree
  - NODE_EDITOR
  - PROPERTIES
  - NODE_HT_header
  - NODE_MT_editor_menus
  - NODE_MT_add
  - NODE_MT_view*
  - NODE_MT_select
  - NODE_MT_node*
  - NODE_MT_context_menu*
  - NODE_MT_group*
  - NODE_PT_active*
operators:
  - node.add_node
  - node.mute_toggle
  - node.select
  - node.view_all
  - node.link
code:
  - src/editors/space_node/main-node-tree.js
  - src/editors/space_node/node-editor-controller.js
  - src/editors/space_node/node-add-menu.js
  - src/editors/space_node/contexts.js
tests:
  - tests/geometry-node-editor.test.js
  - tests/node-editor.test.js
limits:
  - Bylonder's own Geometry Nodes modifier keeps its Babylon graph and opens in Babylon's Node Geometry Editor, not here.
  - The sidebar's Group tab (interface panels) is not shown yet; inputs are added from Group Input's empty socket.
---
# Geometry Node Editor

The Geometry Node Editor shows the node group of the active object's active Geometry Nodes modifier, as in Blender.
The tree is Blender's, held in Main, and evaluated by Blender's geometry nodes; the editor reads it through RNA and
edits it with Blender's own operators, so each edit is an undo step and the 3D Viewport updates
(`docs/node-editors.md`, decision 10).

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=geometry-node-editor)

The demo is a group of sunflowers (`geometry-node-editor.py`). Each head is a plain disc whose node group places its
seeds by Vogel's model of phyllotaxis: the n-th seed turns by n times the golden angle and sits at the square root of
n times a spacing from the middle. The steps below build that spiral from the Default Cube's scene.

## Steps

1. **Start a group.** Delete the cube, Add > Mesh > Plane, then in Properties > Modifiers Add Modifier > Geometry
   Nodes and New. Click the Geometry Nodes workspace tab; the editor shows the new group. Numpad 7 looks down on the
   plane.

   ![A plane, its modifier and the Geometry Nodes workspace](../media/features/geometry-node-editor/start.gif)

2. **Points on a line.** Over the editor, press Shift A and type to search Blender's Add menu; Enter picks the best
   match and a click places it. Add Points (Count 500, Radius 0.015) and Set Position, and link them to Group Output.
   Index, Square Root, Math (Multiply, 0.04) and Combine XYZ give each point an X of the square root of its index
   times 0.04: the points line up, closer together as they go out.

   ![Points, Set Position, and a position from the index](../media/features/geometry-node-editor/points.gif)

3. **Turn by the golden angle.** Add a second Math (Multiply) taking the Index, set to 2.39996 (137.5 degrees in
   radians), and Vector Rotate, which turns the position about Z by it. Linking Vector Rotate to Set Position's
   Position replaces the old link, and the line winds into the sunflower's spirals.

   ![Index times the golden angle into Vector Rotate](../media/features/geometry-node-editor/golden-angle.gif)

4. **Change a value.** Click the angle's field and type. 2.3 and 2.4 radians break the pattern into curved arms; only
   the golden angle packs the points evenly.

   ![2.3, 2.4, then 2.39996](../media/features/geometry-node-editor/angle.gif)

5. **Seeds.** Add Instance on Points and UV Sphere (Radius 0.02) and link them: a seed sits on every point.

   ![Instance on Points with a UV Sphere](../media/features/geometry-node-editor/seeds.gif)

6. **The sunflower.** The example's group does the same in its Seeds frame, with the angle and spacing as modifier
   inputs, a domed head, and seeds that grow and ripen toward the rim (two seed objects picked by the radius); its
   Petals frame runs the same spiral at the rim and instances a petal. Home over the editor shows the whole group.

   ![The Sunflower group, in its Seeds and Petals frames](../media/features/geometry-node-editor/sunflower-tree.png)

## Project files

- [geometry-node-editor.py](../../examples/geometry-node-editor/geometry-node-editor.py): builds the sunflowers, their
  node group, seed and petal objects, sun and camera in Blender 5.2.
- [geometry-node-editor.blend](../../examples/geometry-node-editor/geometry-node-editor.blend): the file the script
  saves.
- Recorded by [record-geometry-node-editor.mjs](../../tools/docs/record-geometry-node-editor.mjs).
