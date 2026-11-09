// Offline render context: a hidden iframe that runs a project from a document snapshot on its own engine and canvas,
// on a virtual clock. The Video Sequencer's scene strips render other scenes in one (sequencer/scene-frames.js), and a
// scene's sound mixes in one (sequencer/scene-audio.js), on an offline audio context its audio engines play into.
// Render Image and Render Animation render the live scene instead (live.js).
import { createEngine } from './gpu-engine.js';
import { sceneReady } from './ready.js';
import { installVirtualClock } from './clock.js';
import { createWorld } from '../runtime/world.js';
import { createFrameRenderer, frameMs } from './frames.js';

const clock = installVirtualClock(window);
const canvas = document.getElementById('render');
const warnings = [];
let built = null, engine = null;

function resize(width, height) {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width; canvas.height = height;
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  engine?.setSize(width, height);
}
const { useCamera, renderFrame } = createFrameRenderer({ world: () => built, engine: () => engine, canvas, resize, clock });

// Opens the scene for rendering; with `audio` ({ frameStart, frameEnd, fps, sampleRate }), for mixing its sound over
// those frames (renderAudio).
let sound = null;
async function open(input, { width, height }, { camera: cameraName, audio } = {}) {
  resize(width, height);
  engine = await createEngine(canvas, { stencil: true, preserveDrawingBuffer: false });
  engine.setHardwareScalingLevel(1);
  if (audio) sound = { ...audio, context: new OfflineAudioContext(2, Math.ceil(((audio.frameEnd - audio.frameStart + 1) / audio.fps) * audio.sampleRate), audio.sampleRate) };
  built = await createWorld({ input, engine, canvas, audioContext: sound?.context, hooks: { notify: text => warnings.push(String(text)) } });
  const { world, scene } = built;
  world.collections.useRenderVisibility();
  engine.setSize(width, height);
  const camera = await useCamera(cameraName);
  // A file's compositor composites final frames on the CPU (frames.js), its views on the GPU.
  world.beforeViewRender({ rendered: true, compositor: !world.compositor.onCPU });
  if (input.overrides?.compositor) await world.compositor.apply(input.overrides.compositor);
  await sceneReady(scene);
  return { camera: camera.name, warnings };
}

// A frame of the scene without drawing it: what its sound follows (its animations, its camera, and the logic its code
// runs around each render), at a fraction of a render's cost.
function advance(scene) {
  scene.onBeforeAnimationsObservable.notifyObservers(scene);
  scene.animate();
  scene.activeCamera?.update();
  scene.onBeforeRenderObservable.notifyObservers(scene);
  scene.onAfterRenderObservable.notifyObservers(scene);
}

// The scene's sound over the frames it was opened for, as its camera hears it (Blender's mixdown of a scene): its own
// Babylon audio engines play into the offline audio context, which pauses at each frame for the scene to move its
// sources and listener there. Null for a scene that makes no sound. progress(done, total) hears of each frame mixed.
async function renderAudio(progress = () => {}) {
  if (!sound || !built.audible) return null;
  await useCamera();
  const { frameStart, frameEnd, fps, context } = sound, { animation, scene } = built, start = animation.time.state.frameStart;
  const reached = [];
  for (let frame = frameStart; frame <= frameEnd; frame++) reached.push(context.suspend((frame - frameStart) / fps));
  animation.time.play();
  const rendering = context.startRendering();
  for (let frame = frameStart; frame <= frameEnd; frame++) {
    await reached[frame - frameStart];
    clock.set(frameMs(frame, start, fps));
    animation.time.configure({ frameCurrent: frame }, { record: false });
    advance(scene);
    progress(frame - frameStart + 1, frameEnd - frameStart + 1);
    context.resume();
  }
  const buffer = await rendering;
  animation.time.pause();
  return { samples: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), sampleRate: buffer.sampleRate };
}

window.bylonderRender = { open, renderFrame, renderAudio, warnings, get clock() { return clock.ms; } };
dispatchEvent(new Event('bylonder-render'));
