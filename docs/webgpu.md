# WebGPU

Bylonder draws with Babylon's WebGL 2 engine by default. Preferences > System > Bylonder > GPU Backend switches to
Babylon's WebGPU engine (`WebGPUEngine`) from the next start; it draws as WebGL 2 does, apart from the limits below.

## How it starts

- `src/render/gpu-engine.js` `createEngine` makes the engine for the app's views (`main.js`) and for offline renders
  (`render/context.js`). The preference is mirrored in the browser's storage, since the engine exists before Blender's
  Preferences load; a `gpu=webgpu` URL parameter overrides it.
- WebGPU asks the adapter for every feature it offers and its highest limits (`enableAllFeatures`,
  `setMaximumLimits`) and logs what the device was granted.
- Without WebGPU (no `navigator.gpu`, no adapter, a device request that fails) the app draws with WebGL 2 and logs why.
- GLSL converts to WGSL with Babylon's builds of glslang and Tint (twgsl), in a worker (`src/render/wgsl-worker.js`,
  `glsl-to-wgsl.js`), off the page's thread; stages of the same WGSL share one shader module. The app serves both
  compilers from `webgpu/` (`scripts/babylon-assets.mjs`, run by `npm run build` and `npm run dev`: the files at the
  installed Babylon version, pinned by sha256), so WebGPU works offline as WebGL 2 does.

## One shader source

Bylonder's shaders are GLSL only, on both backends; Babylon converts them on WebGPU.

- Babylon's PBR materials and Bylonder's Standard materials compile from Babylon's GLSL on WebGPU too
  (`src/overrides/webgpu/pbr-from-glsl.js`), so Bylonder's GLSL plugins on them apply on both backends: curves
  strands, point clouds and the Dithered render method among them. Babylon's shadow generator and GreasedLine's
  materials draw with Babylon's WGSL; Bylonder's edits to them carry WGSL too (`getCustomCode` per shader language):
  the shadow map's lit-side bias and Grease Pencil's scene linear strokes.
- GLSL that does not convert is rewritten into a form that does: one declaration per line (Babylon's GLSL processor
  does not split `uniform float a, b;`). Any GLSL, Bylonder's, Blender's, an example's or a user's, keeps GLSL's rules
  once converted: the engine renames the identifiers WGSL reserves (`from`, `let`, `type`...;
  `src/overrides/webgpu/`, which exported pages apply too) after Babylon has bound every input by name, and turns
  WGSL's derivative uniformity analysis off (Babylon's own switch), as GLSL takes derivatives and samples in any
  control flow.
- Babylon's GLSL to WGSL conversion (Tint) writes WGSL that WebGPU rejects for a NaN constant and, in a shader that
  uses `isnan` or `isinf`, for its uniform arrays; Bylonder's shaders use neither (Blender's curves code makes its
  strip-restarting NaN at run time). FXC (D3D12) fails an implicit-derivative sample in a loop it cannot unroll, so a
  pass that samples per pixel in such a loop reads an explicit level. `tests/webgpu-shaders.test.js` converts
  Bylonder's shaders with the app's glslang and Tint builds and fails on a conversion error or on WGSL WebGPU rejects.
- WebGPU's GLSL takes no sampler as a function argument. On WebGPU, each of Blender's functions called with an image
  runs as a copy for that image (`src/overrides/webgpu/samplers.js`), as do the volume passes' atlas
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
- A node material inverts Babylon's world and view matrices alone, never a product of them (Blender's axes are a swap
  of Babylon's, its own inverse): Tint writes `inverse()` out with its argument repeated in every term, and DXC took
  up to 140 s to compile such a shader (Snow's materials with a normal map), with no frame drawn meanwhile.
  `tests/ir-materials.test.js` fails on an inverse of a product in a node material's shader.
- WebGPU passes at most 28 values between a shader's stages and, unlike WebGL 2, packs no floats together. Babylon
  passes each shadow's depth metric beside its light-space position (one value per shadow, four per sun with cascades);
  on WebGPU the engine derives it in the fragment stage from that position instead
  (`src/overrides/webgpu/depth-metric-varyings.js`, its test checks Babylon's own include text). An upstream candidate:
  Babylon could derive it there on WebGPU itself.
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
- A file of many node materials takes longer to settle than on WebGL 2 (Gaku: Material Preview and Rendered each
  about 75 s in Chrome), and the browser's shader module creation can hold the page for seconds, longest for a light's
  soft cascaded shadows (PCSS).

## GPU profiling

`tools/perf/gpu-profile.mjs` measures where a page's GPU time goes on WebGPU: per render pass, per compute dispatch and
per shader. It opens an example in the dev server with WebGPU, lets it settle (or plays it in the Game area), records
frames and prints a table sorted by GPU time per frame; every frame also goes to a JSON file as it comes, so a stopped
run still leaves its data.

```
node tools/perf/gpu-profile.mjs rigged-character Rig .shots/rigged.json
PLAY=1 FRAMES=60 node tools/perf/gpu-profile.mjs rigged-character Rig .shots/rigged.json
```

- `PLAY=1` profiles the playing game (`STACK=VIEWPORT` for the Viewport modifier stack, `CAP` minutes to wait for its
  first frame), `FRAMES` sets how many frames to record, `WARMUP` the seconds before recording, `ROWS` the table's
  length, `TRACE=file.json` also records a Chrome trace of the same frames (CDP Tracing, GPU categories) to open in
  Perfetto, `E2E_CHROME` runs an installed Chrome as the browser checks do. The page's console errors and uncaught
  errors print as they come.
- How: `tools/perf/gpu-profile-hook.js` runs in every document of the page before its own scripts and sits under
  Babylon at the WebGPU API. It asks for the `timestamp-query` feature and puts begin and end timestamps on every
  render and compute pass that has none (Babylon's own GPU timing, `engine.enableGPUTimingMeasurements`, keeps its
  passes; those are counted without a time). Chrome is started with `--enable-webgpu-developer-features` and
  `--disable-dawn-features=timestamp_quantization`, which give unquantized timestamps. Babylon's timing measures a
  whole frame and each `ComputeShader` in sum, which does not tell passes or meshes apart, hence the hook.
- Labels: a pass is named by its own label (Babylon names render passes by their render target), the debug groups open
  around it and the shaders it ran (a compute kernel by its bindings, `compute(src,dst,joints,idx,wgt)`, else a hash of
  its code). The profiler sets `BYLONDER_GPU_MARKERS` in the page, which turns on Babylon's GPU debug markers and
  makes Bylonder's own dispatches push a group naming the mesh and the kernel (`gpu-deform.js`, `Body: skin`). Off by
  default, it costs a check per dispatch.
- Per frame it also counts what a frame should not repeat: pipelines and shader modules created, bind groups and
  buffers created, buffer writes and their bytes, submits and buffer maps. A steady frame creates none.
- A frame is the work encoded between two animation frame callbacks of a document that encoded any (the callbacks it
  merged are its `rafs`); frames are taken once all their timestamps are read. A render pass also names its target
  (texture label and size), which tells the Game's canvas from the 3D Viewport's.
- A stall with no frames is not on the passes: a trace (`TRACE`) shows the GPU process's work, such as
  `DeviceBase::APICreateRenderPipeline` compiling a shader. The JSON's `pipelines` lists the pipelines made, in order,
  with their shaders, so a slow one in the trace is found by its place; `SHADERS=dir` writes their WGSL, and
  `node tools/perf/pipeline-compile.mjs <vertex.wgsl> <fragment.wgsl> [--edit ...]` times one pipeline's compile in a
  fresh Chrome, with edits (`stub:<function prefix>`, `no-inverse`, `no-derivatives`, `sample-level`) that tell what
  the compiler spends its time on.

### A PIX capture of the same frame (Windows)

Chrome runs WebGPU on D3D12 through Dawn, so PIX on Windows captures it, with the same labels: debug groups are PIX
events, pass and buffer labels name the D3D12 objects.

1. Start Chrome on its own profile, with its GPU process unsandboxed and Dawn passing labels on:
   `chrome.exe --user-data-dir=%TEMP%\pix-chrome --no-sandbox --disable-gpu-sandbox --disable-gpu-watchdog
   --disable-direct-composition --enable-dawn-features=use_user_defined_labels_in_backend,emit_hlsl_debug_symbols,disable_symbol_renaming`
   and open the app with `?gpu=webgpu` (`npm run dev`). Set `globalThis.BYLONDER_GPU_MARKERS = true` in the 3D Viewport
   frame's console before Play, or the page's own groups are missing.
2. In PIX: Select Target Process > Attach, pick Chrome's GPU process (`chrome.exe --type=gpu-process`), Attach, then
   GPU Capture with one frame. The capture's timeline and Events list show the passes and dispatches by these labels,
   with their GPU durations and the D3D12 work Dawn issued for them (barriers, copies).
