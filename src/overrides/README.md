# Overrides

Every place Bylonder works around or changes the behavior of code it does not own lives here, one module per override,
grouped by what it works around:

- `babylon/`: Babylon.js (a subclass, a wrapped method, a replaced shader or a set private field).
- `webgpu/`: WebGPU and its shader toolchain (glslang, Tint, Dawn and its D3D12 compiler FXC), as Babylon's WebGPU
  engine uses them.
- `browser/`: browser behavior (events, service workers).

Each module starts with one line, `// Override of <what>: <what it does and why>; goes when <condition>.`, and code
elsewhere imports it. Modules that exported pages need ship from here (`io_scene_babylon/runtime-files.js`
`OVERRIDE_FILES`, copied to `bylonder/overrides/`); those carry `// @ts-check` and a `.d.ts`. This folder is
MIT OR Apache-2.0, so code derived from Blender's stays out of it.

Overrides of Blender's own code are seams of the WASM module in `tools/blender-port/wasm/`, each marked
`// port-override: <reason>`.

## Overrides that cannot move here

Woven into code that is otherwise Bylonder's own, or derived from Blender's:

- `blenkernel/light/area-specular.js`: area and punctual lights' specular as EEVEE weighs it (Blender-derived).
- `blenkernel/material/dithered-pbr.js`: Babylon's alpha test replaced through a `!` plugin key.
- `draw/draw-view.js`: `REFLECTION_EYE`, Babylon's reflection eye position replaced in its include.
- `draw/overlay-pass.js`: the scene's `_applyByPostProcess` set without its setter around the overlay pass.
- `draw/overlay-grid.js`: no write at a dynamic vector index (FXC), and each vertex holds its index instead of
  `gl_VertexID` (Chromium's software GL).
- `draw/volume-shaders.js`: no `isnan` (Tint's uniform arrays).
- `draw/curves.js`: a macro instead of sampler overloads (ANGLE's D3D11 backend).
- `draw/grease-pencil-render.js`: a WebGL 2 engine of its own beside WebGPU.
- `nodes/blender/glsl.js`: a NaN made at run time (WGSL has no NaN constant).
- `nodes/blender/shader-nodes.js`: `BlenderNodeMaterial` (each block prepared once per pass, every pass's defines reset
  on a build), output variable names, area light samplers in `updateUniformsAndSamples`, `isConnected` on PBR inputs,
  `adaptOutput`'s output type, `buildMaterial`'s queued builds, the image processing block's defines, and the screen
  space ray's level 0 depth reads (FXC, WGSL).
- `runtime/object-transform.js`: lights' and cameras' world matrices for Blender's transforms.
- `runtime/world.js`: `CreateAudioEngineAsync` with the render's audio context and no parameter ramps.
- `io_scene_babylon/babylon-export.js`: what Babylon's serializer leaves out (extra bone influences, a locked target's
  rotation, shadow generators, textures without a name).
- `io_scene_babylon/runtime/area-light.js`: `getScaledIntensity`, an area light scaled by its intensity alone, which
  `babylon/area-light-parse.js` parses lights to.
- `io_scene_babylon/js-export.js`: `SCREEN_SPACE`, screen space pipelines in half floats.
- `io_scene_babylon/runtime/view-transform.js`: the display transform kept the camera's last post process.
- `windowmanager/mouse-capture.js`: Chromium's first move under a new pointer lock.
