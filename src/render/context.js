// Offline render context: the hidden iframe behind Render Image and Render Animation. It runs the project
// from a document snapshot on its own engine and canvas, on a virtual clock, so renders are deterministic
// and the user's viewport is never disturbed (Blender renders from its own evaluated copy of the scene the
// same way). The host (src/editors/render/host.js) creates one per job and talks to window.bylonderRender.
import { Engine, Matrix, Camera } from '@babylonjs/core';
import { installVirtualClock } from './clock.js';
import { createWorld } from '../runtime/world.js';
import { jitter, jitterProjection, sampleTimes, createAccumulator } from './sampling.js';

const clock = installVirtualClock(window);
const canvas = document.getElementById('render');
const warnings = [];
let built = null, engine = null;
const frameMs = (frame, start, fps) => (frame - start + 1) * 1000 / fps;

function resize(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width; canvas.height = height;
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  engine?.setSize(width, height);
}

// Render effects attach to the camera that renders (the scene may already have it active from its code), and
// their shaders compile before its first frame.
let shadedCamera = null;
async function useCamera(name) {
  const { world, scene } = built;
  const camera = name ? scene.cameras.find((c) => c.name === name) : built.authoredCamera;
  if (!camera) throw Error(name ? `No camera named ${name}` : 'No camera found in scene. Add a camera in code or pick one in Properties > Scene.');
  scene.activeCamera = camera;
  if (camera === shadedCamera) return camera;
  shadedCamera = camera;
  world.setViewShading({ renderedCameras: [camera], compositorCamera: camera });
  await scene.whenReadyAsync();
  return camera;
}

async function open(input, { width, height }, { camera: cameraName } = {}) {
  resize(width, height);
  engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });
  engine.setHardwareScalingLevel(1);
  built = await createWorld({ input, engine, canvas, hooks: { notify: text => warnings.push(String(text)) } });
  const { world, scene } = built;
  engine.setSize(width, height);
  const camera = await useCamera(cameraName);
  world.beforeViewRender({ rendered: true, compositor: true });
  if (input.overrides?.compositor) await world.compositor.apply(input.overrides.compositor);
  await scene.whenReadyAsync();
  return { camera: camera.name, warnings };
}

// The scene's own render settings: final frames use its samples and motion blur.
function quality() {
  const { frameStart: start, fps } = built.animation.time.state;
  const { render, eevee } = built.world.renderSettings.state;
  return { start, fps, samples: Math.max(1, Math.round(eevee.taaRenderSamples)), motionBlur: render.useMotionBlur, shutter: render.motionBlurShutter };
}

let surface = null;
function surfaceFor(width, height, samples) {
  if (surface?.width !== width || surface.height !== height || surface.samples !== samples) {
    const out = new OffscreenCanvas(width, height);
    surface = { width, height, samples, out, ctx: out.getContext('2d', { willReadFrequently: samples > 1 }), accumulator: samples > 1 ? createAccumulator(width, height) : null };
  }
  return surface;
}

// Frame the scene state was last advanced to, so sequential final frames pre-roll only once.
let simulated = null;

async function drawFinalFrame(frame, width, height) {
  const q = quality(), job = { ...q, width, height };
  const { out, ctx, accumulator } = surfaceFor(width, height, q.samples);
  // Pre-roll from the start frame so code that integrates time (physics, deltaTime) reaches the same state a
  // full animation render would.
  for (let f = simulated !== null && simulated < frame ? simulated + 1 : q.start; f < frame; f++) await renderSample(f, [0, 0], job);
  const times = sampleTimes(frame, q.samples, q);
  accumulator?.reset();
  for (let s = 0; s < q.samples; s++) {
    await renderSample(times[s], jitter(s, q.samples), job);
    ctx.drawImage(canvas, 0, 0);
    accumulator?.add(ctx.getImageData(0, 0, width, height).data);
  }
  if (accumulator) ctx.putImageData(new ImageData(accumulator.result(), width, height), 0, 0);
  simulated = frame;
  return out;
}

// One frame for a scene strip: a single sample for previews, full quality for final renders.
async function renderFrame({ frame, width, height, camera, quality: kind = 'preview' }) {
  resize(width, height);
  await useCamera(camera);
  if (kind === 'final') return createImageBitmap(await drawFinalFrame(frame, width, height));
  simulated = null;
  const { start, fps } = quality();
  await renderSample(frame, [0, 0], { start, fps, width, height });
  return createImageBitmap(canvas);
}

// Renders one sample at scene frame t (may be fractional) with a sub-pixel jitter, once modifiers have evaluated for
// it off the main thread.
async function renderSample(t, offset, { start, fps, width, height }) {
  const { world, scene, animation } = built;
  const camera = scene.activeCamera;
  clock.set(frameMs(t, start, fps));
  animation.time.configure({ frameCurrent: t }, { record: false });
  await world.modifiers.settled();
  camera.unfreezeProjectionMatrix();
  if (offset[0] || offset[1]) {
    const m = Array.from(camera.getProjectionMatrix(true).m);
    camera.freezeProjectionMatrix(Matrix.FromArray(jitterProjection(m, offset, width, height, camera.mode === Camera.ORTHOGRAPHIC_CAMERA)));
  }
  engine.beginFrame();
  scene.render();
  engine.endFrame();
}


window.bylonderRender = { open, renderFrame, warnings, get clock() { return clock.ms; } };
dispatchEvent(new Event('bylonder-render'));
