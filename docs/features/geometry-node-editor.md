---
id: geometry-node-editor
title: Geometry Node Editor
summary: Show and edit the node group of the active Geometry Nodes modifier, here the Hair Dynamics example's Generate Hair Curves.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/geometry_node.html
  - https://docs.blender.org/manual/en/5.2/modeling/geometry_nodes/index.html
  - https://docs.blender.org/manual/en/5.2/interface/controls/nodes/editing.html
example: hair-dynamics
thumbnail: geometry-node-editor/thumbnail.png
media:
  - geometry-node-editor/open.gif
  - geometry-node-editor/zoom.gif
  - geometry-node-editor/mute.gif
  - geometry-node-editor/add-node.gif
ui:
  - GeometryNodeTree
  - NODE_EDITOR
  - NODE_MT_add
  - PROPERTIES
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

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=hair-dynamics)

The demo is the [Hair Dynamics](hair-dynamics.md) example, built by a Blender script. Its Hair object has two
Essentials node groups as modifiers; the steps below open the first, Generate Hair Curves, and change it.

## Steps

1. **Open the editor.** With Hair selected, click the Shading tab, then pick Geometry Node Editor in the bottom area's
   editor type menu. Hover the editor and press Home to see the whole group.

   ![The editor type menu, then Home](../media/features/geometry-node-editor/open.gif)

2. **Navigate.** Scroll to zoom at the mouse and drag with the middle mouse button to pan. Frames group the nodes as
   their author laid them out.

   ![Zoom in on Distribute Points on Faces](../media/features/geometry-node-editor/zoom.gif)

3. **Mute a node.** Click a node's header to select it and press M. A muted node passes its first input through, and
   the hair is evaluated again; M again unmutes it.

   ![M mutes and unmutes Distribute Points on Faces](../media/features/geometry-node-editor/mute.gif)

4. **Add a node.** Press Shift A over the editor and type to search Blender's Add menu; Enter picks the best match
   and a click places it. Drag from an output socket to an input to link it.

   ![Shift A, type Math, Enter, click](../media/features/geometry-node-editor/add-node.gif)

> **Note** Properties > Modifiers makes a modifier active when its panel is clicked; the editor follows it, so the
> Hair Dynamics group opens the same way.

## Project files

- [hair-dynamics.py](../../examples/hair-dynamics/hair-dynamics.py) and
  [hair-dynamics.blend](../../examples/hair-dynamics/hair-dynamics.blend): the scene and its node groups.
- Recorded by [record-geometry-node-editor.mjs](../../tools/docs/record-geometry-node-editor.mjs).
