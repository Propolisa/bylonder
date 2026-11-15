---
id: game-code
title: Game Code
summary: Game code as behaviours added to objects in Object properties > Behaviors, systems and a game file, written in the project's src/ and run in the Game area with live props, events, waits and hot swap.
expect: A behaviour's props are custom properties of its object, edited as Blender properties and read live by the playing game; saving a file swaps its code in keeping each behaviour's state, and a version that does not load keeps the last good one running; the Game area plays it, and File > Export > JavaScript ships it as game.js, which the page plays the same way; the editor completes the .blend's names. Sounds play, not yet placed in the scene, and there is no game UI layer.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/custom_properties.html
example: rock-hard-cafe
thumbnail: game-code/thumbnail.png
media:
  - game-code/behaviors.png
  - game-code/edit-source.png
  - game-code/play.gif
ui:
  - PROPERTIES
  - OBJECT_PT_custom_props
operators:
  - object.duplicate_move
code:
  - src/io_scene_babylon/runtime/game/define.js
  - src/io_scene_babylon/runtime/game/world.js
  - src/io_scene_babylon/runtime/game/blend-host.js
  - src/io_scene_babylon/runtime/game/input.js
  - src/io_scene_babylon/runtime/game/character.js
  - src/io_scene_babylon/runtime/game/run.js
  - src/io_scene_babylon/game-export.js
  - src/editors/space_game/game-code.js
  - src/editors/space_game/game-types.js
  - src/editors/space_buttons/behaviors-panel.js
  - src/blenkernel/behaviors.js
tests:
  - tests/game-behaviors.test.js
  - tests/game-code.test.js
  - tests/game-types.test.js
  - tests/game-behaviors-wasm.test.js
  - tests/behaviors-panel-wasm.test.js
  - tests/rock-hard-cafe-wasm.test.js
  - tests/game-export.test.js
limits:
  - A mesh's visibility (mesh.visibility below 1) does not fade the exported scene's materials yet: game code can hide a mesh, not fade it.
  - Game sounds (game.play) play at full volume from no place: not yet positioned at the entity they are played at.
  - There is no game UI layer yet (defineUI); a system can draw with Babylon's GUI itself.
  - Hover docs and completion come from TypeScript in the code editor; go to definition from a behaviour to the objects using it is the user count's list, not the editor's.
  - A behaviour that holds several sounds keeps them as a group of the object's custom properties, which Blender's Custom Properties panel shows but does not edit.
---
# Game Code

Game code is plain JavaScript in the project's `src/`, written with three definers from `bylonder`:
`defineBehavior` for logic on an object (one instance per object it is added to), `defineSystem` for game-wide
logic, and `defineGame` for the composition. A behaviour's props are custom properties of its object, so artists set
them in Object properties > Behaviors as Blender properties, and the playing game reads them live. The Game area plays
it all; saving a file swaps its code into the running game, keeping each behaviour's `state`.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rock-hard-cafe)

The demo, Rock Hard Café, is a one-minute shift at an open-air coffee stand in a forest by a brook, whose only
customers are rocks: one at a time a rock rolls up from the trailhead, you pour a coffee at the machine and hand it
over, and it shivers with delight, makes a rock noise, spills it on itself and rolls back down. Each rock's path,
shiver and noise come from the run's seeded random, so every serve plays out differently and a replay plays the same.
The example opens on the Game workspace, the 3D View beside the Game area.

## Steps

1. **Add a behaviour.** Select a rock, open Object properties > Behaviors and choose Add Behavior > Rock. Its props
   (Patience, Noises, Reaction, Stain, Spot, Trailhead, Speed) appear as Blender properties; the count beside its name is its users, and
   hovering it lists the objects that carry it.

   ![Object properties > Behaviors with the Rock behaviour](../media/features/game-code/behaviors.png)

2. **Edit its code.** Click the behaviour's name (Edit Source): the code editor opens its file at
   its `defineBehavior`. Names of the .blend's actions, sounds and collections and the Ink story's knots complete,
   and a misspelt one is flagged.

   ![Edit Source opens rock.js at defineBehavior](../media/features/game-code/edit-source.png)

3. **Play.** The Game area's Play runs the scene with its game code and gives it the keys (a click on the game takes
   them back after you work elsewhere): WASD walks the barista, E pours at the machine and serves a rock. Drag Patience while it plays and the waiting rocks change at once; save `rock.js` and its code is
   swapped in without restarting.

   ![The café playing in the Game area](../media/features/game-code/play.gif)

## Project files

- [cafe.py](../../examples/rock-hard-cafe/cafe.py): builds the café, its prefabs, sounds and behaviours in Blender 5.2.
- [src/behaviors/](../../examples/rock-hard-cafe/src/behaviors/): Rock, Barista, Machine and Spawner.
- [src/systems/](../../examples/rock-hard-cafe/src/systems/): Shift and Subtitles.
- [src/game.js](../../examples/rock-hard-cafe/src/game.js): the composition.
- [content/dialogue/cafe.ink](../../examples/rock-hard-cafe/content/dialogue/cafe.ink): the rocks' lines, an Ink story.
- Recorded by [record-game-code.mjs](../../tools/docs/record-game-code.mjs).
- Credits: the barista and the forest are Quaternius' Universal Animation Library and Stylized Nature MegaKit (CC0),
  [CREDITS.md](../../examples/rock-hard-cafe/CREDITS.md).
