# Bouncing Ball

A 2D Grease Pencil animation, made in Blender 5.2 by `grease-pencil.py` (`blender -b --factory-startup -P
grease-pencil.py`) and opened here with Blender's own reader.

- **Layers.** Ground (one line), Shadow (a filled ellipse whose stroke is hidden) and Ball (a filled, outlined ball),
  drawn on twos: a key every second frame over 24 frames.
- **Animation.** The ball falls, squashes on the ground, stretches as it leaves it and bounces again, lower. Play it
  with Space; the Dope Sheet shows each layer's keys.
- **Onion skinning.** In Draw Mode the frames before and after the current one show in their onion colors.
- **Drawing.** Select the object, switch to Draw Mode with Ctrl Tab and draw on the Ball layer; Interpolate Sequence
  (Grease Pencil > Interpolate Sequence in Edit Mode, or Shift Ctrl E in Draw Mode) fills in the frames between keys.
