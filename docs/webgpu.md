# WebGPU

Bylonder draws with Babylon's WebGL 2 engine by default. Preferences > System > Bylonder > GPU Backend switches to
Babylon's WebGPU engine (`WebGPUEngine`) from the next start. WebGPU is a preview until it draws as WebGL 2 does.

## How it starts

- `src/render/gpu-engine.js` `createEngine` makes the engine for the app's views (`main.js`) and for offline renders
  (`render/context.js`). The preference is mirrored in the browser's storage, since the engine exists before Blender's
  Preferences load; a `gpu=webgpu` URL parameter overrides it.
- WebGPU asks the adapter for every feature it offers and its highest limits (`enableAllFeatures`,
  `setMaximumLimits`) and logs what the device was granted.
- Without WebGPU (no `navigator.gpu`, no adapter, a device request that fails) the app draws with WebGL 2 and logs why.
- Babylon compiles GLSL to WGSL with glslang and Tint (twgsl). The app serves both from `webgpu/`
  (`scripts/webgpu-compilers.mjs`, run by `npm run build` and `npm run dev`: the files at the installed Babylon version,
  pinned by sha256), so WebGPU works offline as WebGL 2 does.

## One shader source

Bylonder's shaders are GLSL only, on both backends; Babylon converts them on WebGPU.

- Babylon's PBR materials and Bylonder's Standard materials compile from Babylon's GLSL on WebGPU too
  (`src/render/gpu-engine.js` `materialsFromGLSL`), so Bylonder's GLSL plugins on them apply on both backends: curves
  strands, point clouds and the Dithered render method among them. Babylon's shadow generator and GreasedLine's
  materials draw with Babylon's WGSL; Bylonder's edits to them carry WGSL too (`getCustomCode` per shader language):
  the shadow map's lit-side bias and Grease Pencil's scene linear strokes.
- GLSL that does not convert is rewritten into a form that does: one declaration per line (Babylon's GLSL processor
  does not split `uniform float a, b;`). Any GLSL, Bylonder's, Blender's, an example's or a user's, keeps GLSL's rules
  once converted: the engine renames the identifiers WGSL reserves (`from`, `let`, `type`...; `src/render/wgsl-names.js`)
  after Babylon has bound every input by name, and turns WGSL's derivative uniformity analysis off (Babylon's own
  switch), as GLSL takes derivatives and samples in any control flow.
- Babylon's GLSL to WGSL conversion (Tint) writes WGSL that WebGPU rejects for a NaN constant and, in a shader that
  uses `isnan` or `isinf`, for its uniform arrays; Bylonder's shaders use neither (Blender's curves code makes its
  strip-restarting NaN at run time). FXC (D3D12) fails an implicit-derivative sample in a loop it cannot unroll, so a
  pass that samples per pixel in such a loop reads an explicit level. `tests/webgpu-shaders.test.js` converts
  Bylonder's shaders with the app's glslang and Tint builds and fails on a conversion error or on WGSL WebGPU rejects.
- WebGPU's GLSL takes no sampler as a function argument. On WebGPU, each of Blender's functions called with an image
  runs as a copy for that image (`src/nodes/blender/glsl.js` `specializeSamplers`), as do the volume passes' atlas
  samples. Babylon's own inliner (`#define inline`) does not fit Blender's functions: it matches by name only and
  cannot keep early returns. Babylon's own functions it marks are left to it, and its PBR's area light function, which
  it leaves unmarked, is marked for it, so area lights light node materials.
- An environment Babylon prefilters on load (Material Preview's studio light, an EXR world) is ready for materials
  only once filtered, so no WebGPU bind group keeps the texture it replaces.
- Babylon's WebGPU engine compiles a draw's pipeline the first time it draws it, so an object coming into view stalls
  the frame. Preferences > System > Bylonder > Prepare Shaders Ahead (on by default) draws every object once, culling
  off, when the views settle with new shaders, and lets them settle once the GPU has compiled those pipelines
  (`src/draw/pipeline-warmup.js`).
- A shader that does not compile fails Render Image and Render Animation with the material's name and the error, on
  both backends; on WebGPU the engine sends Babylon's compile failure through the effect's error path. A pipeline the
  GPU rejects (FXC, a shader compiler Dawn uses on D3D12, fails some WGSL) fails its effect the same way, so the
  objects using it are skipped and reported once instead of invalidating the frame, which would draw nothing.
- WebGPU passes at most 28 values between a shader's stages and, unlike WebGL 2, packs no floats together. Babylon
  passes each shadow's depth metric beside its light-space position (one value per shadow, four per sun with cascades);
  on WebGPU the engine derives it in the fragment stage from that position instead (`src/render/depth-metric-varyings.js`,
  its test checks Babylon's own include text). An upstream candidate: Babylon could derive it there on WebGPU itself.
- Points are drawn as quads on both backends (`src/draw/point-sprites.js`): WebGPU has no point size.
- Reading a texture back is asynchronous on WebGPU. The CPU compositor awaits it on both backends; Grease Pencil's Fill
  tool, which Blender's code reads synchronously, renders on a small WebGL 2 engine of its own.

## Browser checks

`E2E_ENGINE=webgpu` runs the smoke tests and the perf guard on WebGPU. Playwright's Chromium for Windows ships no DXC,
so its WebGPU compiles shaders with FXC, which fails some that Chrome compiles; `E2E_CHROME` (the path of an installed
Chrome) runs them on it instead, in a temporary profile. A WebGPU error no error scope caught (Babylon's "WebGPU
uncaptured error" warning) fails a check as a page error does.

## Compute shaders

Where Blender runs a compute shader (EEVEE's volumes, light probe bake, shadows and Fast GI, the GPU compositor's
passes), Bylonder's WebGPU path runs Blender's own through Babylon's `ComputeShader`, translated from their GLSL by the
compilers Babylon already uses for WebGPU (glslang to SPIR-V, twgsl to WGSL), with as little glue as possible and no
hand-written WGSL copies. Elsewhere a compute path is added only when a measured gain clearly justifies it. WebGL 2 has
no compute shaders and keeps fragment-pass versions of the same steps. None of these compute paths exists yet: every
feature still runs its WebGL 2 version on WebGPU.

## Limits

- Grease Pencil's Fill tool renders on a WebGL 2 engine of its own beside WebGPU.
- Material Preview runs at about half WebGL 2's frame rate.
