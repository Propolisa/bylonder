# Stress test: Blender 5.1 splash (Singularity)

The production file of Blender 5.1's splash screen,
`https://mirror.blender.org/demo/splash/blender-5.1-splash.blend`, opened in Bylonder to find what breaks. The goal is
to make it open, draw and render as the kitchen sink example.

## The file

Measured with Blender 5.2.3 (`--factory-startup -b`), scripts in `/root/work/splash51/notes/`.

| | |
|---|---|
| Size | 670 MB, Zstandard compressed; 1.52 GiB uncompressed |
| Memory | Blender's peak resident memory to load it, before any evaluation: 7.8 GB |
| Scene | `splash-anim`, Cycles at 150 samples, 2000x1000, frame 610, Standard view transform |
| Objects | 1111: 855 meshes, 201 hair curves, 14 curves, 13 armatures, 11 lattices, 8 lights (4 sun, 4 area), 8 empties, 1 camera |
| Geometry | 2.77 M vertices and 5.43 M faces before modifiers |
| Modifiers | 1799 Geometry Nodes, 69 Subdivision Surface, 64 Armature, 56 Decimate, 51 Lattice, 24 Corrective Smooth, 15 Hook, 13 Multiresolution, 7 Mirror, 6 Shrinkwrap |
| Node trees | 180 groups; 169 geometry node types (Bake among them), 58 shader node types, 42 compositor node types |
| Animation | 38 actions, 13 shape key sets, 1146 drivers (1049 simple expressions, 3 Python expressions reading `depsgraph.scene_eval`) |
| Images | 20: 18 packed (240 MB: 10 OpenEXR, 7 TIFF, 3 PNG, up to 5000x5000), 1 UDIM tiled, 1 generated |
| Scripts | 13 texts, 11 registered as modules: CloudRig rig UI (`cloudrig.py` x9), `creature_trail_utils.py`, `update_cache_dirs.py` |
| Add-on data | Brushstroke Tools (`BSBST_*`) and A.N.T. Landscape properties on objects; the add-ons are not in the file |

## What breaks

In the order a user meets it, on `main` at 0f43a95.

1. **File > Open does nothing.** The project store keeps a binary file as a base64 string
   (`src/workspace` project files, `btoa`). A 670 MB file is longer than the longest string V8 allows, so it throws
   `RangeError: Invalid string length` in the console; the user sees no message and no progress.
2. **Reading it crashes the page.** Fed to Blender's reader directly (`mainSync.readBlend`), the tab crashes within
   seconds. `readBlend` copies the bytes twice (`Uint8Array.from`, then into module memory) before Blender
   decompresses 1.52 GiB, and Blender needs 7.8 GB to hold this file while the module is 32-bit WebAssembly, capped at
   4 GiB. The file cannot fit until the module's memory model or Blender's loading changes.

Nothing after reading could be seen yet. From the inventory, these are expected to break or differ once it reads:

- **Render engine**: the scene is set to Cycles; Bylonder renders with its EEVEE-like renderer.
- **Compositor**: 42 compositor node types (Kuwahara, Glare, Cryptomatte, Displace and others); the scene's
  compositing does not run in Bylonder yet.
- **Area light shadows**: Babylon has none, and 4 of the 8 lights are area lights.
- **Bake nodes**: `GeometryNodeBake` reads cache directories outside the file (`update_cache_dirs.py`); without them the
  baked simulation is empty.
- **Scripts**: CloudRig's UI and the trail utilities are registered modules that run only with auto-run enabled; the 3
  Python drivers need it too.
- **Scale**: 1799 Geometry Nodes modifiers over 5.4 M faces, drawn by Babylon; evaluation time and GPU memory are
  unmeasured.
- **UDIM image**: one tiled image; tiled images are untested.

## Plan

1. Store and pass `.blend` files as bytes (Blob in IndexedDB, transferred buffers), with progress and an error report
   in the UI.
2. Read into module memory once, streamed from the file.
3. Measure what Blender holds after reading (packed images, undo copy, evaluated data) and choose between a 64-bit
   module (`MEMORY64`, Chromium allows up to 16 GiB) and loading less (images decoded on first use, no undo copy of a
   read file).
4. Then evaluate, draw and render it, fixing what fails in the order of the list above.
