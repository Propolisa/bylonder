// The frames of a built world (runtime/world.js) as Render Image and Render Animation make them: each final frame
// averages the scene's render samples, jittered and, with motion blur, spread over the shutter, after pre-rolling a
// scene with physics from its start frame. A render context (context.js) renders its own world with it; a render in
// the live scene (live.js) renders the viewport's. Each sample sets the virtual clock to its time.
//   world(): { world, scene, animation, authoredCamera }; engine(); canvas: what the engine draws on;
//   resize(width, height): the canvas's and engine's size; clock: installVirtualClock's
import { Matrix, Camera } from '@babylonjs/core';
import { jitter, jitterProjection, sampleTimes, createAccumulator } from './sampling.js';
import { frameRate } from '../blenkernel/scene/time.js';
import { filmJitter } from './film.js';
import { readySceneDepth } from './scene-depth.js';
import { sceneReady } from './ready.js';

export const frameMs = (frame, start, fps) => (frame - start + 1) * 1000 / fps;

export function createFrameRenderer({ world: built, engine, canvas, resize, clock }) {
  // Render effects attach to the camera that renders (the scene may already have it active from its code), and
  // their shaders compile before its first frame.
  let shadedCamera = null;
  async function useCamera(name) {
    const { world, scene } = built();
    const camera = name ? scene.cameras.find((c) => c.name === name) : built().authoredCamera;
    if (!camera) throw Error(name ? `No camera named ${name}` : 'No camera found in scene. Add a camera in code or pick one in Properties > Scene.');
    scene.activeCamera = camera;
    if (camera === shadedCamera) return camera;
    shadedCamera = camera;
    warm = false;
    world.setViewShading({ renderedCameras: [camera], compositorCamera: camera });
    await sceneReady(scene);
    return camera;
  }

  // The scene's own render settings: final frames use its samples and motion blur.
  function quality() {
    const { state } = built().animation.time, { render, eevee } = built().world.renderSettings.state;
    return { start: state.frameStart, fps: frameRate(state), samples: Math.max(1, Math.round(eevee.taaRenderSamples)), motionBlur: render.useMotionBlur, shutter: render.motionBlurShutter };
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
  // Whether the camera has drawn a frame. Its first draws what was set up for the views before (light shadows the
  // views drew empty), so a render's first frame draws once, adding nothing to the film, before its samples.
  let warm = false;

  async function drawFinalFrame(frame, width, height, progress) {
    const q = quality(), job = { ...q, width, height };
    const { out, ctx, accumulator } = surfaceFor(width, height, q.samples);
    // A scene with physics pre-rolls from the start frame, so it reaches the state a full animation render would; its
    // frames are thrown away, so they draw at the smallest size. Without physics a frame is its time alone.
    const from = !built().scene.isPhysicsEnabled() ? frame : simulated !== null && simulated < frame ? simulated + 1 : q.start;
    if (from < frame) {
      resize(2, 2);
      for (let f = from; f < frame; f++) {
        await renderSample(f, [0, 0], { ...job, width: 2, height: 2 });
        progress?.(f - from + 1, frame - from);
      }
      resize(width, height);
    }
    const times = sampleTimes(frame, q.samples, q);
    // A rendered camera's film (film.js) accumulates the samples in scene linear, filtered as EEVEE's; without one
    // (a scene that renders through its own frame graph), they average as displayed.
    const film = built().world.renderSettings.film?.(built().scene.activeCamera);
    if (film) {
      film.manual = true;
      film.reset();
      try {
        if (!warm) {
          film.sample(null);
          await renderSample(times[0], [0, 0], job);
          warm = true;
        }
        for (let s = 0; s < q.samples; s++) {
          const offset = filmJitter(s);
          film.sample(offset, s);
          await renderSample(times[s], offset, job);
        }
      } finally {
        film.manual = false;
      }
      const { compositor } = built().world;
      if (compositor?.onCPU) progress?.(0, 0, 'Compositing');
      await compositor?.finalFrame(built().scene.activeCamera);
      ctx.drawImage(canvas, 0, 0);
      simulated = frame;
      return out;
    }
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
  // progress(done, total, stage) hears of a final frame's pre-roll, and of its compositing (stage 'Compositing').
  async function renderFrame({ frame, width, height, camera, quality: kind = 'preview', progress }) {
    resize(width, height);
    built().world.mainSync?.fitCamera(await useCamera(camera), { width, height });
    if (kind === 'final') return createImageBitmap(await drawFinalFrame(frame, width, height, progress));
    simulated = null;
    const { start, fps } = quality();
    await renderSample(frame, [0, 0], { start, fps, width, height });
    return createImageBitmap(canvas);
  }

  // Renders one sample at scene frame t (may be fractional) with a sub-pixel jitter, once modifiers have evaluated for
  // it off the main thread and everything it draws is ready.
  async function renderSample(t, offset, { start, fps, width, height }) {
    const { world, scene, animation } = built();
    const camera = scene.activeCamera;
    clock.set(frameMs(t, start, fps));
    animation.time.configure({ frameCurrent: t }, { record: false });
    await world.modifiers.settled();
    // Geometry modifiers just drew may need shaders compiled before it can be drawn.
    await sceneReady(scene);
    await readySceneDepth(scene, camera);
    if (offset[0] || offset[1]) {
      const m = Array.from(camera.getProjectionMatrix(true).m);
      camera.freezeProjectionMatrix(Matrix.FromArray(jitterProjection(m, offset, width, height, camera.mode === Camera.ORTHOGRAPHIC_CAMERA)));
    }
    engine().beginFrame();
    scene.render();
    engine().endFrame();
    // The camera is also the views' camera (camera view): only this sample is jittered.
    camera.unfreezeProjectionMatrix();
  }

  return { useCamera, renderFrame, forget: () => { shadedCamera = null; simulated = null; warm = false; } };
}
