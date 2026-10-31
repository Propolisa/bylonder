# Volcanic island

A film of about three and three-quarter minutes at 24 fps, low poly and toon shaded. A volcano rises from the sea and
a forest grows on it; a flock arrives and lives on it, keeping watch, roosting and fishing. A pair of seabirds court and
raise a chick in a blossom tree. An odd star with a faint trail has been low in the sky from the first frame; it grows
night after night, the flock grows restless and leaves in waves, and just after sunset it slides down the sky as a
plain point of light until it hits the thick air: a bow shock balloons around it, the sound barrier breaks with a double
crack, and it swells over the sea, a burning rock in a violet dusk, the family tiny under it. It breaks up in the air, its fragments
falling far out to sea, and the main chunk strikes the island's far shoulder glancingly, burning that side to glass.
Burning debris over the ridge lights the forest above the nest; then the mountain cracks. The mother sees the fissure
racing down at the tree, cries out and shoves the chick, who has failed to fly twice, off the branch; it flies, and the
blast hurls the tree out over the sea with her on it. The father and the chick call into the smoke from the beach and
sleep pressed together. In the morning a faint call carries round the shore: they find her on the wreck in a sea cave,
one wing bent and a scar across her face; the father hauls it in, she climbs out to them, and the three, sooty from the
fire, huddle together. The camera draws back over the island, its far side glass still glowing in seams and cut open to
its hollow core, its lee still green, everything sooted, the land strewn with ejecta, logs and ash afloat,
a turtle coming ashore and a whale with her calf beyond.

- **Story.** `story.js` holds the film's clock. The story is told in story seconds, which the film plays at its own
  pace: the strike, the push and blast, and the reunion play in slow motion, as Blender's time remapping plays a scene slower, and
  sounds heard then play slower and lower. Island time runs as a time-lapse while the island forms and in short bursts
  between the story's moments; within a moment the sun barely moves. The bursts are solved so each moment has its time
  of day: the strike just after sunset, the rescue in the early morning. The beats, the meteor, the fire's path, the crack
  and the camera's shots are all functions of story time, so playback and renders agree. The beats are timeline markers.
  Each shot makes one steady move and cuts on it; every cut turns the camera 30 degrees or changes the shot's size by half
  (`tests/examples.test.js` checks).
- **Island.** One low-poly mesh from a height field (`island.js`, `createMesh`). The sea is Blender's Circle primitive.
- **Look.** `toon.js` shades every surface flat in hard bands of sun, moon and fire light, with a sky rim and distance
  haze. The ground's colors follow the story: rock, lava, basalt, soil, grass, the burnt path and the blasted glass,
  which cools in uneven seams, with the volcano's strata, conduit and chamber showing in the cutaway. After the strike a
  soot uniform darkens and greys every toon surface. The sky
  draws the sun's shafts, stars, aurora, the new star with its coma and tail, and the meteor's contrail.
- **Family.** `family.js`: the nest tree and its wreck, nest, egg and chick, the sea cave, the parents' flights as keyed paths, and where each bird
  looks, bows, sleeps or looks back, as gaze timelines. The mother's bent wing, her scar and the family's soot are
  pose options of the bird kit, marks painted on its faces.
- **Effects.** `particles.js` makes particles that are each a function of time (born, thrown, falling under gravity and
  drag), as layers of low-poly puffs: the fireball and its trail, its fragments' streamers, each impact's flash, fire,
  debris, sparks, water column, spray, vapor ring, steam and a wave that the island breaks, with foam and surf, the
  strike's smoke column, the forest fire, ash, embers, the bow shock and sonic ring at entry, ejecta strewn over the land and the rubble, logs and ash slicks
  left floating on the sea (`meteor.js`), and steam where the first lava meets the
  sea (`life.js`).
- **Marks.** `marks.js` draws comic marks over the film in flat ink with an outline, each kind its own shape: jagged
  red spikes burst from a bird's head when it calls in alarm, wide arcs swell out from a whale's song and blow, a
  starburst pops at the sound barrier and each great impact and the tree's crash, and speed lines stream behind every falling rock. They
  face the camera at a constant size on screen and come from the cue sheet and the rocks' paths, so they land with the
  sounds.
- **Life.** `forest.js` grows clumps of trees with bushes, ferns and flowering vines between, sways and burns them;
  `life.js` has the flock and its days, the whales, fireflies and the turtle.
- **Sound.** `sounds.js` makes every sound from noise and tones; `audio.js` holds the cue sheet and plays it in
  Babylon's spatial audio, heard from the camera. Beds loop under the film as loud as the story makes them (the sea, the
  wind, the eruption and its steam, insects on warm nights, the forest fire); over them the family's calls come from
  where each bird is, with the egg cracking, the flock, the whales, the tree falling, and the asteroid's roar travelling
  with it, each impact heard as late as its shock reaches the camera. Sound plays with the timeline and is mixed into renders.
- **Camera.** Keys on the camera's location and target (channels **Camera**), linear within a shot and held on its last
  frame, so each shot cuts to the next. Each impact shakes it, later and weaker the farther away it is.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
