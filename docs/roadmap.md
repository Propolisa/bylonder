# Roadmap

Every change to this file is proposed to and approved by the project owner before it is made. Agents and contributors
propose entries; they do not add, edit, reorder or remove them on their own.

## Later

### Load rarely used subsystems on demand

Split Blender's module by subsystem (for example OpenVDB, Bullet, the image libraries, the compositor, the sequencer,
Grease Pencil) so that each part downloads only when it is first needed. Bookmarked until the project is more mature,
because its safety is not yet established.

What is known (measured in Chromium 153):

- Chromium refuses synchronous compile and synchronous instantiation of modules over 8 MB on the main thread, so a
  part cannot be loaded at the moment Blender's code first calls into it.
- Asynchronous compile and instantiate have no size limit and can run in the background.
- Chromium already compiles WebAssembly functions on first call (the 60 MB module compiles in about 0.25 s), so the
  gain is download size, not compile time.
- JSPI is available, but it suspends only calls entered from asynchronous exports; Bylonder calls the module
  synchronously.

The risk: Blender code reaching a part that has not finished loading, through a path that did not wait for it, stops
in the middle of an operation and can leave Blender's data inconsistent.

The proposed safeguards, to be proven before this is done:

- Each part lists what needs it (operators, modifier types, file types); Bylonder awaits the part before calling in.
- All parts load in the background right after startup.
- A test mode that holds back the background load and fails on any call into a part that is not loaded, run over the
  whole unit and browser test suites.

## Optimizations

| User story | Change | Possible gain |
| --- | --- | --- |
| Faster environment map and other float image loads | Upload a float image's buffer as Blender keeps it (premultiplied) and unpremultiply in the shader, instead of copying it in JavaScript first (`src/imbuf/image-textures.js` `straight`) | One full-image copy and one pass over every pixel less per upload: for a 4K HDR (128 MB of floats) an estimated 100 to 300 ms (not yet measured) and 128 MB of peak memory |
| Smoother texture painting on large images | Upload a stroke's changed regions straight from the image buffer with WebGL2's `UNPACK_ROW_LENGTH` and `UNPACK_SKIP_PIXELS`/`UNPACK_SKIP_ROWS`, instead of packing each region into a new array (`region`) | No per-region copy or allocation: less frame time and garbage collection per stroke, growing with brush size |
| Lower latency when dragging a modifier value or editing a dense mesh | Build a mesh's per-corner draw buffers in the module, as Blender's draw cache extractors do, and upload them to the GPU straight from views of module memory, instead of a JavaScript pass over every corner (`src/draw/mesh-batch-buffers.js`) | No JavaScript per-corner loop and no intermediate arrays per evaluation; to be measured on a 1M-face mesh |
| Less memory for large scenes | Babylon meshes keep no CPU copy of their vertex data: picking and bounds read Blender's data, and the Y/Z axis swap is one parent transform instead of a per-vertex rewrite | About two fewer copies of every mesh's vertex data |
| Views of module memory that survive its growth, and a path to Blender's threads | Shared module memory (cross-origin isolation through the module host's service worker), so Babylon can hold long-lived views and Blender's thread pools can run on workers | Fewer copies wherever views are kept; parallel image decoding, Geometry Nodes and modifier evaluation later |
| Dragging a value below a Subdivision Surface modifier stays fast on dense meshes | GPU subdivision as Blender's draw_subdiv does it: the last Subdivision Surface modifier evaluated on the GPU from the coarse mesh, with Blender's subdivision compute shaders and OpenSubdiv's patch evaluation on WebGPU compute (WGSL), a WebGL2 vertex-stage path where WebGPU is missing; patch coordinates and tables stay on the CPU as in Blender | The CPU subdivision skipped while dragging (about 1 s per change at 1M faces today); only the coarse points are uploaded |
