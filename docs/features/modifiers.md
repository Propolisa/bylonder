---
id: modifiers
title: Modifiers
summary: Add, edit and stack modifiers in Properties > Modifiers, here two Array modifiers that turn a cube into a floor of tiles.
expect: Blender's modifiers run Blender's code and give its result; modifier panels cut long labels short.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/modeling/modifiers/index.html
  - https://docs.blender.org/manual/en/5.2/modeling/modifiers/generate/array.html
example: arrays
thumbnail: modifiers/thumbnail.png
media:
  - modifiers/add-array.gif
  - modifiers/count.gif
  - modifiers/second-array.gif
ui:
  - PROPERTIES
  - VIEW_3D
  - OBJECT_MT_modifier*
  - DATA_PT_modifiers
operators:
  - object.modifier_add
  - object.modifier_remove
  - object.modifier_apply
  - object.modifier_set_active
code:
  - src/modifiers/stack.js
  - src/modifiers/array.js
  - src/modifiers/main-modifiers.js
  - src/modifiers/blender.js
tests:
  - tests/modifiers.test.js
  - tests/modifiers-wasm.test.js
limits:
  - The Array Modifiers example builds its arrays from code with Bylonder's Array (Nodes) modifier; the steps here use the Add Modifier menu.
  - Modifier panels lay out Blender's properties in a narrow column, so long labels are cut short.
---
# Modifiers

A modifier changes an object's geometry without touching its mesh data: the stack in Properties > Modifiers runs
from top to bottom, and each modifier can be shown, hidden, reordered, applied or removed. Blender's own modifiers
run Blender's code in the module (`modifiers/modifiers.wasm`), so the result matches Blender's.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=arrays)

The demo, Array Modifiers, has a spiral stair, a colonnade and a floor of tiles made by two stacked arrays. The steps
below make the floor from the Default Cube.

## Steps

1. **Add an Array.** Open the Default Cube example from the splash screen, select the cube, open Properties >
   Modifiers and pick Add Modifier > Generate > Array. The cube is repeated along X.

   ![Add Modifier > Generate > Array](../media/features/modifiers/add-array.gif)

2. **Set the count and offset.** Click Count, type 5 and press Enter, then set Offset X to 1.2 to leave gaps between
   the copies. Dragging a field changes it live.

   ![Count 5, Offset X 1.2](../media/features/modifiers/count.gif)

3. **Stack a second Array.** Add another Array and set its Count to 5, Offset X to 0 and Offset Y to 1.2. It repeats
   the whole row, so the cube becomes a 5 by 5 grid of tiles.

   ![A second Array along Y makes a grid](../media/features/modifiers/second-array.gif)

> **Tip** The header of each modifier has its name, the edit, viewport and render toggles and a menu with Apply,
> Duplicate, Copy to Selected and Move to First or Last, as in Blender.

## Project files

- [index.js](../../examples/arrays/index.js): the stair, the colonnade and the floor, each with `addModifier` from
  the project SDK.
- Recorded by [record-modifiers.mjs](../../tools/docs/record-modifiers.mjs).
