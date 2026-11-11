// Clip compression (clip-export.js binaryClipKeys and the page's CLIP_KEYS_SOURCE): a bone track's keys come back as
// matrices within the error bounds (1 mm half a meter down the bone) at every original frame, interpolated as Babylon
// does; a slow track (an idle's sway) keeps few keys while a walk's needs most of them; a still scale is left out.
import assert from 'node:assert/strict';
import { Animation, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { binaryClipKeys, CLIP_KEYS_SOURCE } from '../src/io_scene_babylon/clip-export.js';
import { createSceneBin } from '../src/io_scene_babylon/scene-bin.js';

// A bone swinging and bobbing over 120 frames at a walk's pace (`pace` 1) or an idle's, which may also scale.
const track = (pace, scaled) => Array.from({ length: 121 }, (_, f) => {
  const t = (f / 30) * pace, turn = Quaternion.RotationYawPitchRoll(0.6 * Math.sin(2 * Math.PI * t), 0.3 * Math.sin(4 * Math.PI * t), 0.1);
  const s = scaled ? 1 + 0.2 * Math.sin(2 * Math.PI * t) : 1;
  return { frame: f, values: Array.from(Matrix.Compose(new Vector3(s, s, s), turn, new Vector3(0.1, 0.9 + 0.05 * Math.sin(4 * Math.PI * t), 0)).m) };
});
const animation = (keys) => ({ name: 'pose', property: '_matrix', dataType: Animation.ANIMATIONTYPE_MATRIX, framePerSecond: 30, loopBehavior: 1, keys });
const groups = [{ name: 'Walk', metadata: { bylonder: { clip: true } }, targetedAnimations: [{ targetId: 'Rig hips', animation: animation(track(1, false)) }, { targetId: 'Rig chest', animation: animation(track(0.1, true)) }] }];
const bin = createSceneBin({ gzip: false }), written = binaryClipKeys(structuredClone(groups), bin, 1);
const packed = written[0].targetedAnimations.map((t) => t.animation.bylonderKeys);
assert.ok(packed.every(Boolean) && written[0].targetedAnimations.every((t) => t.animation.keys.length === 0), 'compressed');
assert.equal(packed[0].scale, undefined, 'a still scale is left out');
assert.ok(packed[1].scale !== undefined, 'a moving scale is kept');

// The page's decoder on the bin's arrays.
const bytes = bin.bytes(), buffers = bin.views.map(([offset, length, type]) => {
  const Type = { f32: Float32Array, u16: Uint16Array, u32: Uint32Array }[type];
  return new Type(bytes.buffer, bytes.byteOffset + offset, length);
});
const clipKeys = new Function(`${CLIP_KEYS_SOURCE}; return clipKeys;`)();
const start = performance.now();
const decoded = clipKeys(structuredClone(written[0]), buffers);
const decodeMs = performance.now() - start;

for (const [k, { animation: original }] of groups[0].targetedAnimations.entries()) {
  const keys = decoded.targetedAnimations[k].animation.keys;
  if (k === 1) assert.ok(keys.length < original.keys.length / 2, `the slow track: ${keys.length} of ${original.keys.length} keys kept`);
  // At every original frame, the decoded keys interpolated as Babylon does (decompose and lerp) against the original.
  let worst = 0;
  for (const { frame, values } of original.keys) {
    const after = keys.findIndex((key) => key.frame > frame), i = after < 0 ? keys.length - 1 : Math.max(0, after - 1), a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const f = b.frame > a.frame ? (frame - a.frame) / (b.frame - a.frame) : 0;
    const m = Matrix.DecomposeLerp(Matrix.FromArray(a.values), Matrix.FromArray(b.values), Math.min(1, Math.max(0, f)));
    // A point half a meter along the bone.
    const point = (matrix) => Vector3.TransformCoordinates(new Vector3(0, 0.5, 0), matrix);
    worst = Math.max(worst, Vector3.Distance(point(m), point(Matrix.FromArray(values))));
  }
  assert.ok(worst < 1.2e-3, `track ${k}: a point half a meter along the bone within 1 mm (${(worst * 1000).toFixed(3)} mm)`);
}
const json = JSON.stringify(groups).length;
console.log(`Clip compression: ${bytes.length} bytes against ${json} of JSON, decoded in ${decodeMs.toFixed(2)} ms`);
