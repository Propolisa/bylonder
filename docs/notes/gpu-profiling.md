# GPU profiling: handover

What the GPU profiling work left, for whoever measures WebGPU next. How to use the tools is in docs/webgpu.md (GPU
profiling).

## The tools

- `tools/perf/gpu-profile.mjs`: per frame, every render pass and compute dispatch with its GPU time (timestamp
  queries), labelled by pass, target, mesh and kernel, and what the frame created. `PLAY=1` profiles the Game area,
  `TRACE` adds a Chrome trace, `SHADERS` writes the WGSL of every pipeline made.
- `tools/perf/pipeline-compile.mjs`: one pipeline's compile time in a fresh Chrome, with edits that remove parts of a
  shader, to find what a compiler spends its time on.
- `tools/perf/play-cost.mjs`: Play's time to the first frame, then the game's frame rate over three spans of 10 s.
- Runs need the GPU slot (`.shots/gpu-yield`) and, for Snow, about 12 GB and its .blend copied into
  `examples/character-controller/` (out again before npm test).

## Snow on WebGPU

- Measured with play-cost on Chrome, Windows: WebGL 2 plays 120 s after Play at 27 to 30 fps; WebGPU 124 s after Play
  at 48 to 54 fps. The native rig's compute deform takes about 1 ms of GPU a frame; the scene's draw into the Display
  Transform target takes about 16.6 ms.
- The 0.1 fps WebGPU showed before was a stall, not a frame rate: DXC compiling six node materials for 18 to 142 s
  each. Node materials now invert Babylon's matrices alone (docs/notes/babylon-inverse-matrices.md, a Babylon proposal
  for `WorldInverse` and `ViewInverse` system values, not posted: the owner decides).

## Left

- About 10 s after Play's first frame on WebGPU with no frame drawn: the remaining first pipelines (about 20 at 0.3 to
  0.7 s each), created at their first draw on the GPU process's main thread. Babylon creates pipelines synchronously
  at draw time; an asynchronous path (`createRenderPipelineAsync`, with the material standing in until it is ready)
  would be an extension module with its own Bylonder setting.
- The Game area's 3D scene costs about 16.6 ms of GPU for a 1596 by 242 target; `gpu-profile.mjs` with `SHADERS` shows
  which of its materials' fragment shaders draw longest.
