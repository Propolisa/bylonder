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

- Babylon's Standard and PBR materials, its shadow generator and GreasedLine's material draw from Babylon's GLSL on
  WebGPU too (their `ForceGLSL` switches), so Bylonder's material plugins and its shadow map edit apply unchanged.
- GLSL that does not convert is rewritten into a form that does: one declaration per line (Babylon's GLSL processor
  does not split `uniform float a, b;`), and no names WGSL reserves (Blender's `type`, `ref` and `target` take other
  names).
- Points are drawn as quads on both backends (`src/draw/point-sprites.js`): WebGPU has no point size.
- Reading a texture back is asynchronous on WebGPU. The CPU compositor awaits it on both backends; Grease Pencil's Fill
  tool, which Blender's code reads synchronously, renders on a small WebGL 2 engine of its own.

## Browser checks

`E2E_ENGINE=webgpu` runs the smoke tests and the perf guard on WebGPU. Playwright's Chromium for Windows ships no DXC,
so its WebGPU compiles shaders with FXC, which fails some that Chrome compiles; `E2E_CHROME` (the path of an installed
Chrome) runs them on it instead, in a temporary profile.

## Limits
