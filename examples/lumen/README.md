# Lumen

A light installation in a dark hall, cut like a music video at 120 beats per minute: a lattice of light turning
above a black mirror, in a halo of light spokes between two colonnades. Four shots of three seconds, each with its
own move.

- **Blender's modifiers make the pieces.** The lattice is an Ico Sphere whose edges Wireframe turns into struts. The
  ribbon is one short edge swept along a helix by Screw (with a screw offset), given thickness by Solidify. The
  colonnades are one blade repeated by Array with a constant offset and mirrored across the hall by Mirror. The halo
  is one bar on a circular array (Array (Nodes)), turned to point outward.
- **Light.** Emissive materials, a glow layer, bloom with chromatic aberration, a black mirror floor with a faint
  grid, haze, and a chrome heart that reflects the hall from a cube map baked once.
- **Cuts with keyframes.** Within a shot the camera moves on smooth curves; the last key of each shot has Constant
  interpolation, so the next key is a hard cut. Location, look-at and field of view are channels of **Camera**.
- **A store driven by keyframes.** The **Mix** store (Properties > Scene) has Energy and Color Swap; both are
  keyframed on the timeline, and every beat flashes on top of them, computed from the frame.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
