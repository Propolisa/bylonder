# Dusk coast

A slow flight north along chalk cliffs at sunset, past a fishing village in its bay, toward a lighthouse that has just
been lit. Twelve and a half seconds at 24 fps.

- **Land and sea.** The terrain is a height field computed in `terrain.js` (tileable noise from `lib/textures.js`),
  colored per vertex by height and slope. The sea is a PBR surface with scrolling ripples and a mirror of the sky,
  cliffs and village.
- **Sky.** A GLSL sky dome (`shaders/sky.frag.glsl`) with the sun's halo, lit cloud streaks, a crescent moon and the
  first stars. It is baked once into a cube map that lights every PBR surface, and the fog takes its horizon color.
- **Light.** A low sun with long shadows over the downs, god rays streaming from the sun's disc, and bloom.
- **Blender primitives and modifiers.** The lighthouse is Blender's Cone and Cylinder primitives: Wireframe makes the
  gallery railing from an open cylinder, Bevel rounds the gallery. Cottages are `createMesh` walls and roofs with
  Solidify and Bevel, placed as instances.
- **Animation.** The camera path and where it looks are keyframes (channels **Camera**); the beam turns on a linear
  curve (channels **Lighthouse Beam**). Waves, clouds and gulls follow the frame, so renders repeat exactly.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
