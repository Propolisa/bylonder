import assert from 'node:assert/strict';
import { Constants, NullEngine, Scene, Matrix, Vector3, FreeCamera } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRenderSettings, outputSize } from '../src/blenkernel/scene/render.js';
import { displayExponent, displayedViewSettings } from '../src/render/view-settings.js';
import { outputSpec, encodeSize, containers } from '../src/render/formats.js';
import { installVirtualClock, seededRandom } from '../src/render/clock.js';
import { halton, jitter, sampleTimes, jitterProjection, createAccumulator } from '../src/render/sampling.js';
import { createFilm, filmJitter } from '../src/render/film.js';
import { ditherOffset } from '../src/render/dither.js';

// Output settings live in the render slice, shaped like Blender's scene.render.
const engine = new NullEngine(), scene = new Scene(engine);
const settings = createRenderSettings({ scene, animation: createAnimationModel() });
assert.equal(settings.capture(), undefined, 'defaults save nothing');
assert.deepEqual(outputSize(settings.state.render), { width: 1920, height: 1080 });
settings.set('render.resolutionPercentage', 50);
settings.set('render.resolutionX', 1280);
assert.deepEqual(outputSize(settings.state.render), { width: 640, height: 540 });
const saved = settings.capture();
assert.equal(saved.render.resolutionPercentage, 50);
assert.equal(saved.render.resolutionX, 1280);
settings.apply(undefined);
assert.equal(settings.state.render.resolutionX, 1920, 'apply(undefined) restores defaults');
settings.apply(saved);
assert.equal(settings.state.render.resolutionPercentage, 50);

// Render settings code sets are the baseline: they are not saved as edits, and edits are saved against them.
const authored = createRenderSettings({ scene, animation: createAnimationModel() }, { authored: { render: { useMotionBlur: true }, eevee: { taaRenderSamples: 64 } } });
assert.equal(authored.state.render.useMotionBlur, true);
assert.equal(authored.state.render.resolutionX, 1920, 'other settings keep their defaults');
assert.equal(authored.capture(), undefined);
authored.set('eevee.taaRenderSamples', 8);
assert.deepEqual(authored.capture(), { eevee: { taaRenderSamples: 8 } });
authored.dispose();

// Formats: Blender's output settings map to browser outputs; impossible pairs are rejected.
const video = { image_settings: { file_format: 'FFMPEG' }, ffmpeg: { format: 'MKV', codec: 'H264', constant_rate_factor: 'MEDIUM', ffmpeg_preset: 'GOOD', video_bitrate: 6000, gopsize: 18,
  audio_codec: 'NONE', audio_bitrate: 192, audio_channels: 'STEREO', audio_mixrate: 48000, audio_volume: 1 } };
assert.deepEqual(outputSpec(video), { kind: 'video', container: 'MKV', mime: 'video/x-matroska', ext: 'mkv', codec: 'avc', bitrate: 'QUALITY_HIGH', latencyMode: 'quality', gopsize: 18, audio: null });
// The sequencer's mix as the Audio panel sets it.
assert.deepEqual(outputSpec({ ...video, ffmpeg: { ...video.ffmpeg, audio_codec: 'AAC', audio_channels: 'MONO', audio_volume: 0.5 } }).audio, { codec: 'aac', bitrate: 192000, channels: 1, rate: 48000, volume: 0.5 });
assert.throws(() => outputSpec({ ...video, ffmpeg: { ...video.ffmpeg, format: 'WEBM', codec: 'WEBM', audio_codec: 'AAC' } }), /WebM cannot hold AAC audio/);
assert.equal(outputSpec({ ...video, ffmpeg: { ...video.ffmpeg, constant_rate_factor: 'NONE' } }).bitrate, 6000000, 'Constant Bitrate in kbit/s');
assert.throws(() => outputSpec({ ...video, ffmpeg: { ...video.ffmpeg, format: 'WEBM' } }), /WebM cannot hold H.264/);
assert.equal(outputSpec({ image_settings: { file_format: 'JPEG', quality: 80 } }).quality, 0.8);
assert.throws(() => outputSpec({ image_settings: { file_format: 'OPEN_EXR' } }), /cannot write OPEN_EXR/);
for (const c of Object.values(containers)) assert.ok(c.codecs.length > 0);
assert.deepEqual(encodeSize({ width: 961, height: 541 }, true), { width: 962, height: 542 }, 'video sizes are even');
assert.deepEqual(encodeSize({ width: 961, height: 541 }, false), { width: 961, height: 541 });

// Virtual clock: time sources follow the job, randomness is repeatable, and uninstall restores them.
const target = { performance: { now: () => 123 }, Date, Math: Object.create(Math), requestAnimationFrame: () => 7, cancelAnimationFrame() {} };
const realDateNow = Date.now;
const clock = installVirtualClock(target, { seed: 5 });
clock.set(41.5);
assert.equal(target.performance.now(), 41.5);
assert.equal(target.Date.now(), Date.UTC(2000, 0, 1) + 41.5);
assert.equal(target.requestAnimationFrame(() => assert.fail('render loops never tick')), 0);
const first = [target.Math.random(), target.Math.random()];
clock.reseed(5);
assert.deepEqual([target.Math.random(), target.Math.random()], first, 'same seed, same sequence');
assert.ok(first.every(v => v >= 0 && v < 1));
clock.uninstall();
assert.equal(target.performance.now(), 123);
assert.equal(Date.now, realDateNow);
assert.equal(target.requestAnimationFrame(), 7);
assert.notDeepEqual([seededRandom(1)(), seededRandom(2)()][0], seededRandom(2)());

// Sampling: Halton jitter inside the pixel, shutter times centered on the frame and never past one frame.
assert.equal(halton(1, 2), 0.5);
assert.equal(halton(2, 3), 2 / 3);
assert.deepEqual(jitter(0, 1), [0, 0], 'one sample is not jittered');
for (let i = 0; i < 16; i++) jitter(i, 16).forEach(v => assert.ok(Math.abs(v) <= 0.5));
assert.deepEqual(sampleTimes(10, 3), [10, 10, 10]);
assert.deepEqual(sampleTimes(10, 2, { motionBlur: true, shutter: 0.5 }), [9.875, 10.125]);
const wide = sampleTimes(10, 4, { motionBlur: true, shutter: 2 });
assert.ok(Math.min(...wide) >= 9.5 && Math.max(...wide) <= 10.5, 'shutter is limited to one frame');

// Jitter moves projected points by the requested pixel offset, for left- and right-handed perspective.
for (const rh of [false, true]) {
  const projection = (rh ? Matrix.PerspectiveFovRH : Matrix.PerspectiveFovLH)(0.8, 2, 0.1, 100);
  const point = new Vector3(0.3, -0.2, rh ? -5 : 5);
  const ndc = m => Vector3.TransformCoordinates(point, m);
  const jittered = Matrix.FromArray(jitterProjection(Array.from(projection.m), [0.5, -0.25], 200, 100));
  assert.ok(Math.abs(ndc(jittered).x - ndc(projection).x - 0.005) < 1e-6, 'x shift is 0.5 px of 200');
  assert.ok(Math.abs(ndc(jittered).y - ndc(projection).y + 0.005) < 1e-6, 'y shift is -0.25 px of 100');
}
const ortho = Matrix.OrthoLH(4, 2, 0.1, 100);
const jo = Matrix.FromArray(jitterProjection(Array.from(ortho.m), [1, 0], 100, 50, true));
assert.ok(Math.abs(Vector3.TransformCoordinates(Vector3.Zero(), jo).x - 0.02) < 1e-6);

// EEVEE's film jitters each sample within its pixel.
assert.ok(Array.from({ length: 64 }, (_, i) => filmJitter(i)).every(([x, y]) => Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5));
// Hashed transparency over a film's samples: each sample shifts every pixel's noise by its own offset, so what a pixel
// keeps over the samples is the surface's coverage, whatever the pixel's noise (EEVEE's hashed_alpha_threshold).
{
  const filmScene = new Scene(engine), camera = new FreeCamera('Film', new Vector3(0, 0, -5), filmScene);
  const film = createFilm(filmScene, camera), offsets = [];
  for (let i = 0; i < 16; i++) offsets.push((film.sample(filmJitter(i)), ditherOffset(filmScene)));
  film.sample(null);
  assert.equal(ditherOffset(filmScene), 0, 'a complete film draws with no offset');
  const coverage = 0.3, kept = (noise) => offsets.slice(0, 16).filter((offset) => coverage > (offset + noise) % 1).length / 16;
  for (const noise of [0, 0.13, 0.5, 0.77, 0.99]) assert.ok(Math.abs(kept(noise) - coverage) <= 1 / 16, `a pixel of noise ${noise} keeps ${kept(noise)}`);
  film.dispose();
  filmScene.dispose();
}
// Accumulator averages in floating point.
const acc = createAccumulator(1, 1);
acc.add([0, 10, 255, 255]); acc.add([1, 11, 0, 255]);
assert.deepEqual([...acc.result()], [1, 11, 128, 255]);
acc.reset(); assert.equal(acc.count, 0);

// Render effects per rendered view: each camera owns its pipelines, so a view leaving Rendered shading takes only
// its own effects along, and nothing routes every camera through the scene-wide prepass.
{
  const engine = new NullEngine(); engine.getCaps().maxMSAASamples = 4;
  const scene = new Scene(engine), a = new FreeCamera('a', Vector3.Zero(), scene), b = new FreeCamera('b', Vector3.Zero(), scene);
  const settings = createRenderSettings({ scene, animation: createAnimationModel() });
  for (const [path, value] of [['eevee.useRaytracing', true], ['eevee.taaSamples', 4], ['render.useMotionBlur', true]]) settings.set(path, value);
  const pipelinesOf = camera => scene.postProcessRenderPipelineManager.supportedPipelines.filter(p => p.cameras.includes(camera));
  const effectsOf = camera => camera._postProcesses.filter(Boolean);
  settings.setRenderedCameras([a, b]);
  assert.equal(pipelinesOf(a).length, 2, 'samples and fast GI on the first view');
  assert.equal(pipelinesOf(b).length, 2, 'samples and fast GI on the second view');
  const kept = effectsOf(b);
  settings.setRenderedCameras([b]);
  assert.deepEqual(effectsOf(a), [], 'a view leaving Rendered shading drops its effects');
  assert.equal(pipelinesOf(b).length, 2, 'the other view keeps its pipelines');
  assert.deepEqual(effectsOf(b), kept, 'and its post processes');
  assert.ok(!scene.prePassRenderer?.enabled, 'no scene-wide prepass');
  assert.deepEqual(effectsOf(b).slice(0, 2).map((p) => p.name), ['__film', '__filmResolve'], "EEVEE's film first, in scene linear");
  scene.onBeforeCameraRenderObservable.notifyObservers(b);
  assert.match(effectsOf(b).at(-1).name, /displayTransform/, 'Fast GI, Screen Trace and motion blur in scene linear, before the display transform');
  assert.ok(settings.film(b) && !settings.film(a), 'a rendered view has a film');
  assert.ok(!effectsOf(b).some((p) => /motion/i.test(p.name)), "no motion blur in a view, as in EEVEE's viewport");
  settings.dispose();
  assert.deepEqual(effectsOf(b), []);
  scene.dispose(); engine.dispose();
}

// A Blender camera's depth of field (Main's, through the module) on the rendered view that looks through it, as
// Babylon's: its f-stop, focal length and focus distance in millimeters, and none for a camera without it.
{
  const engine = new NullEngine(), scene = new Scene(engine), camera = new FreeCamera('Camera', Vector3.Zero(), scene), other = new FreeCamera('view', Vector3.Zero(), scene);
  const mainSync = { cameraDof: (c) => (c === camera ? { focusDistance: 6.9, fStop: 2.8, lens: 50 } : null) };
  const settings = createRenderSettings({ scene, animation: createAnimationModel(), mainSync });
  settings.setRenderedCameras([camera, other]);
  const pipelineOf = (c) => scene.postProcessRenderPipelineManager.supportedPipelines.find((p) => p.cameras.includes(c) && 'depthOfFieldEnabled' in p);
  for (const c of [camera, other]) scene.onBeforeCameraRenderObservable.notifyObservers(c);
  const { depthOfField } = pipelineOf(camera);
  assert.ok(pipelineOf(camera).depthOfFieldEnabled, 'the camera with depth of field blurs');
  assert.deepEqual([depthOfField.fStop, depthOfField.focalLength, Math.round(depthOfField.focusDistance)], [2.8, 50, 6900]);
  assert.ok(!pipelineOf(other).depthOfFieldEnabled, 'a camera without it does not');
  settings.dispose(); scene.dispose(); engine.dispose();
}

// A rendered view displays through its own last post process, Blender's order of exposure, view transform and look, and
// view gamma (render/display-transform.js), not Babylon's image processing; the gamma raises the displayed color to
// 1 / gamma (colormanagement.cc colormanage_exponent).
{
  const engine = new NullEngine(), scene = new Scene(engine), camera = new FreeCamera('c', Vector3.Zero(), scene);
  const settings = createRenderSettings({ scene, animation: createAnimationModel() });
  settings.setRenderedCameras([camera]);
  const names = () => camera._postProcesses.filter(Boolean).map((p) => p.name);
  assert.match(names().at(-1), /displayTransform/, 'the display transform is the last post process');
  assert.ok(!names().some((name) => name.includes('imageProcessing')), "without Babylon's image processing");
  const display = camera._postProcesses.filter(Boolean).at(-1);
  assert.equal(display._textureType, Constants.TEXTURETYPE_HALF_FLOAT, 'its scene linear input keeps half floats, so the darks do not band');
  settings.set('viewSettings.gamma', 0.41);
  assert.match(names().at(-1), /displayTransform/, 'at another gamma too');
  assert.equal(displayExponent(0.41), 1 / 0.41);
  assert.equal(displayExponent(0), 100, "at most OCIO's exponent");
  // Material Preview and Solid display with the view transform and look only (draw_color_management.cc).
  settings.set('viewSettings.exposure', 1);
  settings.setView({ rendered: true, sceneLinear: true });
  assert.equal(scene.imageProcessingConfiguration.exposure, 2, 'a rendered view with the scene exposure');
  settings.setView({ rendered: false, sceneLinear: false });
  assert.equal(scene.imageProcessingConfiguration.exposure, 1, 'Material Preview and Solid without it');
  assert.deepEqual(displayedViewSettings({ viewTransform: 'STANDARD', look: 'HIGH_CONTRAST', exposure: 1, gamma: 0.5 }, false),
    { viewTransform: 'STANDARD', look: 'HIGH_CONTRAST', exposure: 0, gamma: 1 });
  settings.dispose(); scene.dispose(); engine.dispose();
}

settings.dispose(); scene.dispose(); engine.dispose();
console.log('Render: output settings, formats, virtual clock and sampling passed');
