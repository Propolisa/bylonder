---
id: game
title: Game
summary: Bylonder's own editor that plays the scene as File > Export > JavaScript ships it, run by the exported page's runtime, while edits, undo and redo made in the app reach the running game.
expect: Play exports the scene in memory and runs it in the area on an engine of its own, as its page does; a value edit (a move, a material colour, backface culling or alpha cutoff, a light's power, exposure, colour or spot cone, a camera's lens, sensor or orthographic scale, the scene camera's place, which game code that moves the camera builds on, the view's exposure or gamma, visibility, a shape key, a custom property) shows in the game on the next frame, and the scoped export behind it checks it once the app is idle, loading the game fresh if they disagree; other edits reach it as a patch after that export (about a second on Rigged Character); the game's own state never writes back to the scene; Reset starts the game again from the scene as it is now; Play takes as long as an export, and takes the area into Focus Mode with the page fullscreen, which Esc, Back or the corner button leave; Stop ends the game and frees its engine, scene, physics and sound; a Game area hidden by the layout draws nothing.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/import_export.html
example: rigged-character
thumbnail: game/thumbnail.png
media:
  - game/play.gif
  - game/back.gif
  - game/edit.gif
  - game/stack-render.png
  - game/stack-viewport.png
  - game/stop.gif
ui:
  - TOPBAR_MT_file_export
operators:
  - screen.screen_full_area
  - ed.undo
  - ed.redo
code:
  - src/editors/space_game/game-view.js
  - src/editors/space_game/GameView.vue
  - src/editors/space_game/game-run.js
  - src/editors/space_game/package-link.js
  - src/editors/screen/area-shown.js
  - src/editors/space_package/package-preview.js
  - src/io_scene_babylon/controls-export.js
  - src/io_scene_babylon/export-settings.js
  - src/io_scene_babylon/scoped-export.js
  - src/io_scene_babylon/scene-patch.js
tests:
  - tests/area-shown.test.js
  - tests/game-run-wasm.test.js
  - tests/game-instant-edits-wasm.test.js
  - tests/controls-coverage-wasm.test.js
  - tests/export-evaluation-wasm.test.js
  - tests/live-package-wasm.test.js
  - tests/package-preview-wasm.test.js
  - tests/export-scoped-wasm.test.js
limits:
  - A separate window is not built yet.
  - A change of the scene, its world, a node group or a collection exports the whole scene, so on a large scene it reaches the game after an export's time.
  - The scene's frame range, frame rate, gravity, motion blur, render engine and EEVEE settings load the game fresh after the export (tests/controls-coverage-wasm.test.js lists them); a light's type, shape, area size and influence radius, and a camera's type and sensor fit, remake that object through an export of it alone, started at once (about 0.1 s on Rigged Character, a light's type about 1 s).
  - Exported pages do not draw a light's color temperature, transmission, power normalization, soft falloff, spread, or Blender's shadow resolution, filter, jitter and cascade settings yet (their shadows have a fixed bias, map size and filter per light type), so editing those changes nothing in the game. tests/controls-coverage-wasm.test.js lists them.
  - A camera's lens shift (Shift X and Y) is not drawn by exported pages yet, so the game shows the camera unshifted.
  - A value the game animates (an F-Curve's or a driver's) is the game's: an edit of it reaches the game through the export only.
  - Lock Camera to View moves Rock Hard Café's camera in the 3D View without the game following yet (it follows on Rigged Character).
  - Where game code holds a part of the scene camera itself (`game.camera.follow`, a fitted field of view), an edit of that part is not shown; the header says so.
---

# Game

The Game area plays the scene the way an exported page does: File > Export > JavaScript's package, written in memory
and run by the page's own runtime in the app's own modules, on an engine of its own. While it plays, what you change in the app reaches it: an edit, undo or redo becomes
a patch the running game applies, keeping its state. Nothing the game does writes back to the scene. It is Bylonder's
own editor, chosen from an area's editor type menu.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rigged-character)

## Steps

1. Open an area's editor type menu and choose Game, then press Play. The scene is exported and its page plays in the
   area, in Focus Mode: the area alone, without its header, and the page fullscreen. Preferences > System > Bylonder >
   Play in Focus Mode turns that off.

   ![Game chosen and played in Focus Mode](../media/features/game/play.gif)

2. Press Esc, the phone's Back, or the faint button in the top right corner: the area goes back to its place in the
   layout and the game keeps playing. In its header, Pause holds the game and Reset starts it again from the scene as
   it is now. While the layout hides the area (another area maximized, or a folded drawer closed), the game draws
   nothing.

   ![Back to the layout](../media/features/game/back.gif)

3. Edit the scene while it plays: move an object, change a material's colour or a light's power. The game shows the
   value on its next frame. Behind it the change is exported and checked; the header shows the export and says when
   the game was loaded fresh. Undo and redo of a value reach it the same way. Structural edits (a mesh, node links, a
   new modifier or object) reach the game once that export is done.

   ![The game following an edit](../media/features/game/edit.gif)

   The scene camera follows too: moving it in the 3D View (a grab or the sidebar's Transform),
   or changing its lens, moves the game's view. Game code that moves the camera builds on it: each frame it starts
   from `game.camera.authored`, the camera as the scene places it now, so the authored camera stays the base. Where the
   game's code holds a part of the camera itself (a follow camera's place, a field of view fitted to the play area),
   an edit of that part is not shown, and the header says so.

4. Choose the modifier stack the game evaluates in its header, Viewport or Render. It is the scene's export setting
   (File > Export > JavaScript's Modifier Stack, saved in the .blend), Render by default. Choosing one exports the scene
   again and loads the game fresh; the header says so. Here the body's Armature modifier is off in viewports and on in
   renders: Render poses the body by its rig, Viewport leaves it at rest.

   ![Render chosen](../media/features/game/stack-render.png)

   ![Viewport chosen, the game loaded fresh](../media/features/game/stack-viewport.png)

5. Press Stop. The game ends: its engine, scene, physics, game code and sound are disposed and its render loop stops,
   so the app runs as fast as before Play. Play starts it again from the scene.

   ![Stop](../media/features/game/stop.gif)

## Project files

The [Rigged Character](../../examples/rigged-character/) example's files.
