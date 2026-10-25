// Offline render context: the hidden iframe behind Render Image and Render Animation. It runs the project
// from a document snapshot on its own engine and canvas, on a virtual clock, so renders are deterministic
// and the user's viewport is never disturbed (Blender renders from its own evaluated copy of the scene the
// same way). The host (src/render/host.js) creates one per job and talks to window.bylonderRender.
import { Engine, Matrix, Camera } from '@babylonjs/core';
import { installVirtualClock } from './clock.js';
import { createWorld } from '../runtime/world.js';
import { createWriter } from './output.js';
import { jitter, jitterProjection, sampleTimes, createAccumulator } from './sampling.js';

const clock = installVirtualClock(window);
const canvas = document.getElementById('render');
const warnings = [];
let built = null, engine = null;
const frameMs = (frame, start, fps) => (frame - start + 1) * 1000 / fps;

async function open(input, { width, height }) {
  canvas.width = width; canvas.height = height;
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });
  engine.setHardwareScalingLevel(1);
  built = await createWorld({ input, engine, canvas, hooks: { notify: text => warnings.push(String(text)) } });
  const { world, scene } = built;
  const camera = built.authoredCamera;
  if (!camera) throw Error('No camera found in scene. Add a camera in code or pick one in Properties > Scene.');
  engine.setSize(width, height);
  scene.activeCamera = camera;
  world.setViewportRendered(true);
  world.compositor.syncCamera();
  if (input.overrides?.compositor) await world.compositor.apply(input.overrides.compositor);
  await scene.whenReadyAsync();
  return { camera: camera.name, warnings };
}

// Renders one sample at scene frame t (may be fractional) with a sub-pixel jitter.
function renderSample(t, offset, { start, fps, width, height }) {
  const { world, scene, animation } = built;
  const camera = scene.activeCamera;
  clock.set(frameMs(t, start, fps));
  animation.time.configure({ frameCurrent: t }, { record: false });
  world.modifiers.refresh();
  camera.unfreezeProjectionMatrix();
  if (offset[0] || offset[1]) {
    const m = Array.from(camera.getProjectionMatrix(true).m);
    camera.freezeProjectionMatrix(Matrix.FromArray(jitterProjection(m, offset, width, height, camera.mode === Camera.ORTHOGRAPHIC_CAMERA)));
  }
  engine.beginFrame();
  scene.render();
  engine.endFrame();
}

// job: { frames: [scene frames], start, fps, width, height, samples, motionBlur, shutter, spec, name }
// onFrame(bitmap, { frame, index, count }) previews each finished frame. Resolves to { blob, filename }.
async function render(job, { onFrame = () => {}, signal } = {}) {
  const { width, height, samples } = job;
  const out = new OffscreenCanvas(width, height), ctx = out.getContext('2d', { willReadFrequently: samples > 1 });
  const accumulator = samples > 1 ? createAccumulator(width, height) : null;
  const writer = await createWriter(job.spec, { width, height, fps: job.fps, name: job.name, frames: job.frames.length });
  const aborted = () => { if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError'); };
  try {
    // Pre-roll from the start frame so code that integrates time (physics, deltaTime) reaches the same state
    // a full animation render would.
    for (let f = job.start; f < job.frames[0]; f++) { aborted(); renderSample(f, [0, 0], job); }
    for (let index = 0; index < job.frames.length; index++) {
      const frame = job.frames[index];
      const times = sampleTimes(frame, samples, { motionBlur: job.motionBlur, shutter: job.shutter });
      accumulator?.reset();
      for (let s = 0; s < samples; s++) {
        aborted();
        renderSample(times[s], jitter(s, samples), job);
        if (accumulator) { ctx.drawImage(canvas, 0, 0); accumulator.add(ctx.getImageData(0, 0, width, height).data); }
        else ctx.drawImage(canvas, 0, 0);
      }
      if (accumulator) ctx.putImageData(new ImageData(accumulator.result(), width, height), 0, 0);
      onFrame(await createImageBitmap(out), { frame, index, count: job.frames.length });
      if (job.spec.kind === 'video') await writer.add(new VideoFrame(out, { timestamp: Math.round(index * 1e6 / job.fps) }));
      else await writer.add(out, frame);
    }
    built.scene.activeCamera?.unfreezeProjectionMatrix();
    return await writer.finish();
  } catch (error) {
    await writer.cancel();
    throw error;
  }
}

window.bylonderRender = { open, render, warnings, get clock() { return clock.ms; } };
