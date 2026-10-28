# Still life with lemons

Glass, glaze, brass and fruit on a walnut table, lit by a window and a candle, after the Dutch still lifes of the 1600s.
The camera dollies along the table for ten seconds while the focus moves from the lemons to the glass.

- **Turned objects.** The carafe, wine glass, bowl, candlestick, lemons and pear are profiles of edges (`createMesh`,
  like Blender's `Mesh.from_pydata`) turned by Blender's Screw modifier, with Solidify for the glass and glaze walls
  and Subdivision Surface to smooth them. Select one and open Properties > Modifiers to change the profile's turns
  or the wall thickness.
- **Modifiers on primitives.** The cloth is a Grid rippled by the Wave modifier; the pear's stalk is a Cylinder bent
  by Simple Deform; table and wall are boxes rounded by Bevel.
- **Materials.** PBR with refraction (glass), clear coat (glaze, oiled walnut), sheen (linen, grape bloom),
  translucency (lemon peel, grapes) and hammered brass. Every texture is computed in `lib/textures.js`.
- **Light.** A window key light with contact-hardening shadows, a candle whose flame flickers with the frame, and a
  cube map of the room baked once for reflections.
- **Lens.** An 85 mm lens with depth of field, bloom and vignette. Focus distance and f-stop are keyframed on the
  timeline (channels **Lens**), like the dolly (channels **Camera**).

Look through the camera (Numpad 0) in Rendered shading, press Space to play, and use Render > Render Animation for
the final clip, at 48 samples with motion blur.
