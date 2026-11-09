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

- Babylon's own materials (Standard, PBR, GreasedLine) and its shadow generator draw with Babylon's WGSL on WebGPU, as
  Babylon tests them. Bylonder's plugins on them carry their edits in WGSL too (`getCustomCode` per shader language):
  the area light specular, the view's eye, Grease Pencil's scene linear strokes, and the shadow map's lit-side bias.
  The rest stay GLSL and do not apply on WebGPU (see Limits).
- GLSL that does not convert is rewritten into a form that does: one declaration per line (Babylon's GLSL processor
  does not split `uniform float a, b;`), and no names WGSL reserves (Blender's `type`, `ref` and `target` take other
  names).
- WebGPU's GLSL takes no sampler as a function argument. On WebGPU, each of Blender's functions called with an image
  runs as a copy for that image (`src/nodes/blender/glsl.js` `specializeSamplers`). Babylon's own inliner
  (`#define inline`) does not fit Blender's functions: it matches by name only and cannot keep early returns. Babylon's
  own functions it marks are left to it, and its PBR's area light function, which it leaves unmarked, is marked for it,
  so area lights light node materials.
- An environment Babylon prefilters on load (Material Preview's studio light, an EXR world) is ready for materials
  only once filtered, so no WebGPU bind group keeps the texture it replaces.
- Points are drawn as quads on both backends (`src/draw/point-sprites.js`): WebGPU has no point size.
- Reading a texture back is asynchronous on WebGPU. The CPU compositor awaits it on both backends; Grease Pencil's Fill
  tool, which Blender's code reads synchronously, renders on a small WebGL 2 engine of its own.

## Browser checks

`E2E_ENGINE=webgpu` runs the smoke tests and the perf guard on WebGPU. Playwright's Chromium for Windows ships no DXC,
so its WebGPU compiles shaders with FXC, which fails some that Chrome compiles; `E2E_CHROME` (the path of an installed
Chrome) runs them on it instead, in a temporary profile.

## Limits

- A Principled BSDF with the Dithered render method is alpha tested, not hashed: Blender's hash is GLSL.
- Hair and curves with a Principled material draw no strands in Material Preview and Rendered, and point clouds draw
  each point as a square: their shaders are GLSL plugins on Babylon's PBR material.
- Grease Pencil's Fill tool renders on a WebGL 2 engine of its own beside WebGPU.
- Material Preview runs at about half WebGL 2's frame rate.
- Render Image's compositor output differs from the render (smoke check: 118 of 255 on average).
