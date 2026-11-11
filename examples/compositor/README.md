# Akari Noodle House

A small ramen bar, 麺屋 灯 (Menya Akari, "the noodle house of the lamp"), in a narrow yokocho lane on a wet night, made in Blender 5.2 by
`compositor.py` (`blender -b --factory-startup -P compositor.py`) and opened here with Blender's own reader.

- **Sign.** Text objects in Zen Maru Gothic and Poiret One (in `fonts/`, SIL Open Font License, loaded by the script;
  Zen Maru Gothic is a subset of the glyphs the scene uses) with a negative Offset and a round Bevel, so each stroke is
  a glass tube, converted to meshes; a bowl, chopsticks and steam drawn as beveled curves; all in emissive materials on
  a dark backplate with standoffs.
- **The bar.** A timber front with the window and the door cut out by Boolean, a tiled eave with chochin lanterns, a
  noren over the door and a らーめん lightbox. Inside, a shallow lit room: menu tags, a shelf of bowls, a stockpot,
  paper lanterns, a counter, two customers eating (one raising a bowl and chopsticks) and a cook, each a few spheres
  and tubes.
- **The lane.** Narrow two-storey frontages on both sides, timber below and plaster or corrugated metal above: another
  izakaya or two with red and white chochin, lit noren and standing kanji lightboxes, a kissa with its shutter half
  down, shut shops, shoji windows lit upstairs, utility poles with tangled power lines, vending machines, styrofoam
  boxes, beer crates, plants, a scooter, a bicycle, stools and rain streaks. Each frontage is one joined object.
- **People.** One woman outside on a tea break, and two people upstairs seen as soft shapes through translucent paper
  in front of lamp-lit rooms, are Quaternius's Animated Woman (CC0 1.0: https://poly.pizza/m/9kF7eTDbhO), in
  `models/animated-woman.glb`. The script seats each from the model's own SitIdle animation, turns the arms and curls
  the fingers from its own rig to hold a cup, and repaints its palette texture in muted colors.
- **City.** Far beyond the lane's roofs, dark towers with sparse lit windows, warning lights and tall video ads, half
  lost in fog cards whose alpha is a Noise Texture.
- **Street.** Wet asphalt and puddles: flat faces in a dark Principled material with Roughness 0.02 that mirror the
  shop when Raytracing is on.
- **Loop.** 240 frames at 24 fps (10 s) that repeat seamlessly: every animation's period divides the loop, made of
  keyframes repeated by an F-Curve Cycles modifier. The lanterns under the eave and the noren panels sway, the dead tube
  of 灯 stutters back to life once, the cyan tubes dip twice, the rain falls in 20-frame cycles (two stacked copies, drawn
  below 6.5 m only), ripples spread in the puddles, the airship bobs and the fog banks drift, and the camera breathes a
  few centimeters. The woman keeps her rig, hidden in the viewport as an animator leaves it: her chest rises with each
  breath and once a loop she lifts the cup (bone parented to her hand) for a sip; the diner in the window lifts the
  chopsticks. Her rig's actions are Idle and Sip, which NLA strips play on the timeline, and Walk and Sit on muted
  tracks, for File > Export > JavaScript with Animations set to Clips (the Noodle Shop game plays all four). Steam is particles emitted from well before frame 1, so it is already rising at the start; its puffs are
  random, so the steam changes slightly at the loop's seam.
- **Compositor.** Render Layers, Glare (Fog Glow), Lens Distortion with a little Dispersion, a Color Balance grade and
  a vignette (an Ellipse Mask, blurred, multiplied over the image) into the Group Output; a Viewer shows the result.
- **Render.** Render > Render Image composites the render with Blender's own compositor.
