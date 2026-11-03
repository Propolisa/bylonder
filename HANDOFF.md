# Handoff: EEVEE parity, items 3 and 4

Branch `eevee-parity-3-next`, on top of 9a1fd06 (anti-aliasing). Coded and unit-tested (npm test files render,
light-shadows, export, properties pass); not measured in the browser and not gated. Remove this file before merging.

## Item 3: view transforms

- `src/render/view-transform.js`: a display pass, last on a rendered camera, in place of Babylon's image processing:
  exposure, then Standard as the exact sRGB curve, or AgX and Filmic through a 33^3 LUT on log2 axes (-12.5 to 12.5
  stops), then Blender's display gamma.
- LUTs: `src/render/view-transforms/{agx,filmic}.bin`, made by `tools/blender-reference/view-transform-luts.py` with
  Blender 5.2.3's bundled PyOpenColorIO and its config.ocio.
- Offline, LUT against OCIO exact over 20000 random colors (dE mean / p99 / max): AgX 0.40 / 1.43 / 4.5, Filmic
  0.22 / 0.51 / 0.8. A Khronos PBR Neutral LUT measured 0.86 / 4.5 / 9.0, Babylon's analytic tone map 0.16 / 1.0 / 2.5,
  so Khronos stays on Babylon's (approved).
- `render-babylon.js` adds AGX and FILMIC to `viewTransforms` (Material Preview falls back to Babylon's Standard tone
  map); `render.js` and RNA add `view_settings.gamma`. Exports turn Babylon's image processing back on (nearest tone map).
- `useExactSrgbConversions: true` on the app's and render context's engines: Material Preview's sRGB was Babylon's 2.2
  power approximation.
- Left: measure each view against EEVEE renders of the gallery with that transform (reference renders made headless
  with `blender -b shader_gallery.blend` setting `view_settings.view_transform`), measure Standard with the exact
  curve, add a limit line with the dE, and "Looks are not applied" (approved to skip Looks: one LUT per view and look).
  Reading a .blend's view transform into Bylonder (main-sync only pushes it) is not done.

## Item 4: sun shadow cascades

- `src/blenkernel/light/light-shadows.js`: a sun casts through a `CascadedShadowGenerator` (4 cascades, lambda 0.9,
  not stabilized) whose map size is the nearest power of two at or above the canvas's larger side (texel about a
  pixel), with PCF QUALITY_LOW (about one texel); recreated when the canvas size changes. NullEngine falls back to one map.
- Left: measure on the orthographic gallery floor tiles 21 to 24 and the perspective floor (baseline 2.0 to 5.1 mean,
  99th 18 to 47; perspective 1.7 / 26) and keep it only if both improve; tune numCascades, lambda, filteringQuality;
  check the frame cost and shadow acne (bias 0.002, normalBias 0.02 were tuned for the 2048 map).
