---
id: drivers-and-graph-editor
title: Drivers and the Graph Editor
summary: Shape animation as F-curves in the Graph Editor, repeat or shake them with F-curve modifiers, and drive one property from others with drivers, here a steam engine whose flywheel moves everything else.
expect: F-curves, their modifiers and drivers are Blender's and evaluate as in Blender, simple expressions without Python; a driver's Python expression starts Python on first use, which takes a few seconds.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/graph_editor/introduction.html
  - https://docs.blender.org/manual/en/5.2/editors/graph_editor/fcurves/modifiers.html
  - https://docs.blender.org/manual/en/5.2/animation/drivers/introduction.html
  - https://docs.blender.org/manual/en/5.2/animation/drivers/drivers_panel.html
  - https://docs.blender.org/manual/en/5.2/editors/drivers.html
example: drivers-and-graph-editor
thumbnail: drivers-and-graph-editor/thumbnail.png
media:
  - drivers-and-graph-editor/play.gif
  - drivers-and-graph-editor/graph-editor.png
  - drivers-and-graph-editor/speed.gif
  - drivers-and-graph-editor/drivers.png
  - drivers-and-graph-editor/noise.png
ui:
  - FCURVES
  - DRIVERS
  - VIEW_3D
  - GRAPH_HT_header
  - GRAPH_MT_key*
  - GRAPH_MT_select
  - GRAPH_MT_view
  - GRAPH_PT_properties
  - GRAPH_PT_key_properties
  - GRAPH_PT_modifiers
  - GRAPH_PT_drivers
  - GRAPH_PT_driven_property
operators:
  - graph.view_all
  - graph.select_all
  - transform.resize
  - graph.fmodifier_add
  - anim.driver_button_add
  - anim.driver_button_remove
  - screen.animation_play
  - ed.undo
code:
  - src/editors/animation/anim-area.js
  - src/blenkernel/animation/anim-blender.js
  - src/blenkernel/main-sync.js
tests:
  - tests/anim-wasm.test.js
  - tests/animation.test.js
limits:
  - Bylonder keeps an object's rotation in Euler YXZ; keys on an XYZ rotation of an object turned on more than one axis play in the wrong order (the file's warning says so), so the flywheel's mesh is stood up and only its Y rotation is keyed.
  - A driver whose expression needs Python (anything Blender's simple expression evaluator does not take) waits until Python has started, a few seconds after its first use.
  - The example's drivers and modifiers are made by its script; the steps show them and change a key rather than build them from nothing.
---
# Drivers and the Graph Editor

The Graph Editor shows an object's animation as F-curves, one per animated property, with their keys and handles;
its sidebar holds the active F-curve's and key's properties and its modifiers, which change the curve after its keys:
Cycles repeats it, Noise shakes it, Generator, Envelope, Stepped and Limits reshape it. A driver sets a property from
an expression over variables (other properties, transforms, distances), evaluated every time those change; the
Drivers editor lists them. All of it is Blender's animation system in the module: the editors are Blender's spaces,
drawn by Blender's code.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=drivers-and-graph-editor)

The demo, Steam Engine, is made in Blender by a script (`drivers-and-graph-editor.py`). Only the flywheel is keyed;
drivers turn its angle into the crosshead's travel, the connecting rod's position and tilt, the governor's spin and
the swing of its arms, and a Noise modifier shakes the pressure gauge's needle.

## Steps

1. **Play it.** Press Space: the flywheel turns and everything linked to it follows.

   ![The engine running](../media/features/drivers-and-graph-editor/play.gif)

2. **The flywheel's F-curve.** Select Flywheel and switch the Timeline to the Graph Editor (Editor Type menu). Its Y
   Euler Rotation has two keys a turn apart, linear; the sidebar's (N) Modifiers tab shows the Cycles modifier that
   repeats them for as long as the scene runs.

   ![The Graph Editor with the Cycles modifier](../media/features/drivers-and-graph-editor/graph-editor.png)

3. **Change its speed.** With the pointer over the graph, A selects both keys and S X 0.5 Enter scales them in time
   to half: the flywheel turns twice as fast, and every driven part keeps up. Ctrl Z puts them back.

   ![Scaling the keys in time](../media/features/drivers-and-graph-editor/speed.gif)

4. **A driver.** Select Crosshead and switch to Drivers. Its X Location's driver reads the flywheel's Y rotation as
   `a` and computes the slider-crank's travel, `0.45*cos(a) + sqrt(2.25 - 0.45*sin(a)*0.45*sin(a))`. Right click a
   property > Add Driver makes one; an expression like this one runs without Python.

   ![The Drivers editor](../media/features/drivers-and-graph-editor/drivers.png)

5. **A Noise modifier.** Select Needle: its rotation has one key, and a Noise modifier on the curve makes it tremble.

   ![The needle's Noise modifier](../media/features/drivers-and-graph-editor/noise.png)

## Project files

- [drivers-and-graph-editor.py](../../examples/drivers-and-graph-editor/drivers-and-graph-editor.py): builds the
  engine, its keys, F-curve modifiers and drivers, the lights and the camera, in Blender 5.2.
- [drivers-and-graph-editor.blend](../../examples/drivers-and-graph-editor/drivers-and-graph-editor.blend): the file
  the script saves.
- [index.js](../../examples/drivers-and-graph-editor/index.js): opens the .blend with Blender's reader.
- Recorded by [record-drivers-and-graph-editor.mjs](../../tools/docs/record-drivers-and-graph-editor.mjs).
