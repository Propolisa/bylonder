# Volcanic island

A two-minute film at 24 fps, low poly and toon shaded. A volcano rises from the sea and a forest grows on it. A pair of
seabirds raise a chick in a blossom tree. An odd star with a faint trail has been low in the sky from the first frame;
it grows night after night, then falls on the island late one afternoon. Its fire runs down through the forest to the
nest tree. The mother pushes the chick, who has failed to fly twice, off the burning branch; it flies, and she falls
with the tree. The father and the chick keep out at sea through the night, and come home at first light to the sapling
growing where the tree stood.

- **Story.** `story.js` holds the film's clock: island time runs as a time-lapse whose speed follows the story,
  solved so the climax (1:45) falls at sunset and the homecoming at first light. The beats, the meteor, the fire's path
  and the camera's shots are all functions of the film's time, so playback and renders agree. The beats are timeline
  markers.
- **Island.** One low-poly mesh from a height field (`island.js`, `createMesh`). The sea is Blender's Circle primitive.
- **Look.** `toon.js` shades every surface flat in hard bands of sun, moon and fire light, with a sky rim and distance
  haze. The ground's colors follow the story: rock, lava, basalt, soil, grass, the burnt path and its healing. The sky
  draws the sun's shafts, stars, aurora, the new star with its coma and tail, and the meteor's contrail.
- **Family.** `family.js`: the nest tree, nest, egg and chick, and the parents' flights as keyed paths.
- **Effects.** `particles.js` makes particles that are each a function of time (born, thrown, falling under gravity
  and drag), as layers of low-poly puffs: the fireball and its trail, the strike's flash, fire, debris, dust ring,
  sparks and smoke column, the forest fire, ash, embers and petals (`meteor.js`), and steam where the first lava meets
  the sea (`life.js`).
- **Life.** `forest.js` grows, sways, burns and regrows the trees; `life.js` has the flock, the whales and fireflies.
- **Camera.** Keys on the camera's location and target (channels **Camera**), linear within a shot and held on its last
  frame, so each shot cuts to the next.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
