# Orrery

A clockwork orrery in brass, blued steel and polished stone, turning in a dark studio. Its sun lights the planets and
its gears mesh as they drive them. Fifteen seconds: a close look at the gear train, a rise that reveals the machine,
and a slow circle around it.

- **Machined parts from Blender's modifiers.** Gears are one n-gon outline each (`createMesh`), given thickness by
  Solidify and chamfered by Bevel; their teeth have the same pitch, so they mesh. The drum is a profile turned by
  Screw. The armillary and Saturn's rings are square sections turned by Screw and rounded by Bevel. The marble plinth
  and the arms are boxes rounded by Bevel; posts and planets are Blender's Cylinder and UV Sphere, smooth shaded.
- **Materials.** Brushed brass with anisotropic highlights, polished gold and silver, blued steel under a clear coat,
  a pearl with iridescence, and procedural stones (lapis with pyrite, banded malachite, jasper, veined black marble)
  computed in `lib/textures.js`. The sun is emissive and glows.
- **Light.** A key with soft shadows, cool rim lights, and a light inside the sun. Softboxes that only reflections see
  are baked once into the scene's environment.
- **Render settings from code.** `renderSettings` turns on Raytracing (screen-space reflections in the lacquer floor
  and ambient occlusion), Motion Blur and 32 samples for final renders.
- **Choreography.** Every orbit, gear, ring and the camera are keyframes on the timeline: linear curves for the
  machine (one channel group per orbit and gear), smooth curves for the camera. The lens focuses on what the camera
  looks at.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
