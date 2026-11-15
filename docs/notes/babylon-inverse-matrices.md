# Inverse matrices for node materials (a Babylon proposal, not posted)

A proposal for Babylon.js, kept here until the owner decides whether to open it upstream.

## What

Two more `NodeMaterialSystemValues`: `WorldInverse` (per mesh) and `ViewInverse` (per view), set by Babylon on the CPU
as it sets `World` and `View`. Babylon already keeps a view's inverse for its own shaders (a camera's world matrix) and
computes the world's inverse where its materials need it.

## Why

Blender's shader nodes read the object's and the view's inverse matrices (`ModelMatrixInverse`, `ViewMatrixInverse`:
the Normal Map node's tangent, Texture Coordinate's Object output, the camera data). A node material built from
Babylon's own blocks can only reach `World` and `View`, so Bylonder's node materials invert them in the fragment shader
(`runtime/materials.js` and `node-material-export.js`, `MATRICES`), once per pixel, for a value that is the same for
every pixel of an object.

## Measured

- On WebGPU in Chrome on Windows, Babylon converts GLSL to WGSL (glslang, then Tint), which writes `inverse()` out with
  its argument repeated in every term. When the argument was a product (`inverse(S * world * S)`, Blender's axes from
  Babylon's), DXC took 18 to 142 s to compile each of Snow's six node materials with a normal map, one after another
  on the GPU process's main thread: the Game area showed no frame for 190 to 300 s after Play
  (`tools/perf/gpu-profile.mjs`, `TRACE`).
- Inverting Babylon's matrix alone (`S * inverse(world) * S`, as S is its own inverse) brought one of them from 17.7 s
  to 0.9 s (`tools/perf/pipeline-compile.mjs`), as fast as the same shader with no inverse at all (0.8 s). That is the
  fix in place; `tests/ir-materials.test.js` fails on an inverse of a product in a node material's shader.
- What stays is about a hundred multiplies and adds per pixel per inverse, which `WorldInverse` and `ViewInverse` as
  system values would remove, with no `inverse()` left in a node material's shader for any compiler to expand.
