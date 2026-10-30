# Volcanic island

A small tropical island in time-lapse, thirty seconds at 24 fps. The volcano pours lava down five channels to the sea;
the lava cools to basalt and weathers to soil; grass spreads up from the beaches and a forest grows, palms by the shore
first, pines highest up. Days and nights pass ever faster, from a few hours a second to a day a second, and the clouds
race round the island to show it.

- **Story.** `story.js` turns frames into days of island time and says when each thing happens. Everything that changes
  (light, lava, soil, grass, trees, clouds, smoke) follows the frame, so playback and renders agree.
- **Island.** One low-poly mesh from a height field (`island.js`, `createMesh`), its grid jittered so its faces are
  irregular. The sea is Blender's Circle primitive.
- **Look.** `toon.js` shades every surface flat, lit in hard bands by the sun and the moon, with a rim of sky light. The
  ground's colors are the story's: rock, glowing lava, basalt, soil and grass. The sky has a sunset band and stars.
- **Forest, clouds and smoke.** Trees, cloud puffs and smoke are a few low-poly meshes (`forest.js`, Blender's Ico
  Sphere) repeated as thin instances that grow, move and fade with the frame.
- **Camera.** One orbit of the island in keyframes (channels **Camera**).

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
