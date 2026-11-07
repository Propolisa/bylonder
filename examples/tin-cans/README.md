# Tin Cans

Made in Blender 5.2 by `tin-cans.py` (`blender -b --factory-startup -P tin-cans.py`) and opened here with Blender's
own reader.

- **Atlas.** One 2048 x 2048 image, packed into the file: three can labels stacked as bands and a brushed tin lid in
  the bottom corner.
- **Cans.** Cylinders with a small Bevel. Each side is unwrapped onto its label's band, each cap onto the lid; one
  material reads the atlas as Base Color and turns metallic where the UVs sit in the lid's band.
- **Editing.** Open UV Editing to see a can's UVs over the atlas; moving the side's island one band moves the can to
  another label.
