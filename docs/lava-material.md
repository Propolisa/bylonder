# A displaced lava sphere

A sphere displaced by a Clouds texture, with a glowing lava material made from Blender's shader nodes. Every step is
Blender's own UI and gives Blender 5.2.3's result.

## The sphere

1. File > New > General opens a project with a sphere. Or, in Default Cube, select the cube, press X and Delete, then
   Shift A > Mesh > UV Sphere.
2. Properties > Modifiers: Add Modifier > Generate > Subdivision Surface.
3. Add Modifier > Deform > Displace. In its panel, the Texture field's New button makes a texture and gives it to the
   modifier.
4. Properties > Texture shows that texture. Set Type to Clouds. Noise Basis, Size and Depth (the number of octaves)
   shape it; the Displace modifier's Strength and Midlevel set how far it moves the surface.

The modifiers and the texture run Blender's own code (`modifiers/modifiers.wasm`, `bmesh.wasm`), so vertex positions
match Blender's (`tests/textures-wasm.test.js`).

## The material

1. Click the Shading workspace tab: the 3D Viewport in Material Preview over the Shader Editor.
2. In the Shader Editor, New Material makes Blender's new material: Principled BSDF into Material Output.
3. Shift A adds the nodes; drag from a socket to a socket to link them:
   - Input > Texture Coordinate. Its Object output into a Texture > Noise Texture set to 4D. W is the seed; Scale,
     Detail (octaves), Roughness and Lacunarity shape it.
   - Noise Texture's Fac into Converter > Color Ramp (Blender 5 lists it under Color). Edit its stops: click a stop
     on the band to pick it and drag it, + and - add and remove stops, the swatch below sets the stop's color.
   - Color Ramp's Color into Principled BSDF's Emission Color, Noise Texture's Fac into Emission Strength.
   - A second Noise Texture, 4D, with the same W and coordinates and a higher Detail, its Fac into Vector > Bump's
     Height, Bump's Normal into Principled BSDF's Normal.
4. Material Preview and Rendered shading (the header's shading buttons) show the material. Edits rebuild it as
   Blender recompiles its shader.

## Differences from Blender

- Material Preview lights the scene with Babylon's studio environment, not Blender's forest.exr, with the scene's
  lights off as Blender's default.
- Bump takes the height's screen derivatives (Blender's fast derivative path), not the height again at offset points.
- Principled BSDF is Babylon's PBR block lit by Babylon's lights; its emission is added as Blender's is. Its sockets
  are drawn in one list, without Blender's collapsible panels.
- The Texture tab's preview is empty, and the Shading workspace has no Image Editor yet.
- In Main (the scene sync), the material's node tree holds the nodes, their input values and links; the nodes' own
  properties (Noise Texture's dimensions, Color Ramp's stops) stay in the material's Babylon graph.
