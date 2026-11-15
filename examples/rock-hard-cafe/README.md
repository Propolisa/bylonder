# Rock Hard Café

An endless day at an open-air coffee stand in a forest by a brook, whose only customers are rocks: one at a time a
rock rolls up from the trailhead and waits across the counter. You reach over with the barista's right hand, take the
cup the machine brews onto its tray, steer it round the jars and set it down on the rock, which shivers with delight,
clacks, spills it off and rolls back down, stained. The reach is Blender's IK and constraints on the barista's rig,
solved live in the page; the cups and jars are Blender rigid bodies the game runs on Havok.

- **Scene.** `cafe.py` (`blender -b --factory-startup -P cafe.py`) writes `rock-hard-cafe.blend` and the sounds in
  `sounds/`: the forest (../character-controller/environment.py), the brook, the stand and its machine, the barista
  and his reach constraints, one waiting rock, the stand spot, the trailhead and the Play Area the camera frames, and
  the Rock A, B, C and Cup collections the game spawns copies of. Each object's behaviours are its `behaviors` custom
  properties (Object properties > Behaviors); what Havok moves is each object's rigid body (Physics properties >
  Rigid Body).
- **Code.** `src/behaviors/` (Rock, Barista, Cup, Machine, Spawner), `src/systems/` (Shift, Subtitles, Hud, Framing,
  Music), `src/game.js`.
- **Content.** `content/dialogue/cafe.ink`, the rocks' noises and lines, an Ink story; `content/music/cafe.ogg`, the
  music.
- **Play.** The example opens on the Game workspace. Play, then the mouse (or the right stick) moves the hand over the
  counter, holding Space or the left button grabs a cup under the palm, letting go sets it down; WASD walks the
  barista; M mutes the music.
- **Credits.** CREDITS.md: the mannequin and the forest are Quaternius' (CC0), the sounds Kenney's (CC0), the music
  "Bubble Gum Groovin'" by Eric Matyas, www.soundimage.org (CC BY 3.0).
