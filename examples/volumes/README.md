# Temple Light

A temple hall at sunset, made in Blender 5.2 by `volumes.py` (`blender -b --factory-startup -P volumes.py`) and
opened here with Blender's own reader.

- **Dust.** One box over the hall with a Principled Volume and no surface. Its Density is a Noise Texture through a
  Map Range: a faint haze with thicker wisps. The box's location is keyed from frame 1 to 240, so the dust drifts as
  the frames play.
- **Sun.** A low sun outside the left wall, Cast Shadow on. The windows, their mullions and the columns shadow the
  dust, which shows the light as shafts.
- **Candles.** Two point lights at the altar, which light the dust near them.
- **Volumes.** Properties > Render > Volumes: 8 pixel tiles, 64 samples.
- **Render.** Rendered shading in the 3D Viewport (Z > Rendered), Play to see the dust drift, or Render > Render Image
  through the camera.
