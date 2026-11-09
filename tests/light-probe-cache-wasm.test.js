// An Irradiance Volume's light cache as Blender keeps it (Object.lightprobe_cache, through
// tools/blender-port/wasm/lightprobe-api.cc): a .blend EEVEE baked (tests/fixtures/lightprobe-room.blend, made by
// tools/blender-reference/lightprobe-fixtures.py) opens with its cache, and a bake the page writes reads back as written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { blendData, pointerOf } from '../src/python/bpy_rna.js';
import { readCache, writeCache } from '../src/draw/light-probe-cache.js';

const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [], animation } }), ids: animation.ids });
sync.readBlend(readFileSync(new URL('./fixtures/lightprobe-room.blend', import.meta.url)), scene);
const ob = pointerOf([...blendData().objects].find((o) => o.name === 'Volume'))[2];

const baked = readCache(ob);
assert.deepEqual(baked.size, [6, 6, 4], "EEVEE's grid of samples");
const n = 6 * 6 * 4;
assert.equal(baked.irradiance[0].length, n * 3);
assert.ok(baked.irradiance.every((band) => band.every(Number.isFinite)) && baked.visibility.every((band) => band.every(Number.isFinite)), 'finite harmonics');
assert.ok(baked.irradiance[0].reduce((sum, v) => sum + v, 0) / (n * 3) > 0, 'the room holds light');
assert.ok(baked.validity.some((v) => v > 0), 'validity per sample');

const size = [2, 3, 4], m = 24, ramp = (k, length) => Float32Array.from({ length }, (_, i) => k + i / 100);
const written = { size, irradiance: [0, 1, 2, 3].map((k) => ramp(k, m * 3)), visibility: [0, 1, 2, 3].map((k) => ramp(-k, m)), validity: Uint8Array.from({ length: m }, (_, i) => i * 10) };
writeCache(ob, written);
const read = readCache(ob);
assert.deepEqual(read.size, size);
for (let k = 0; k < 4; k++) {
  assert.deepEqual(Array.from(read.irradiance[k]), Array.from(written.irradiance[k]), `irradiance band ${k}`);
  assert.deepEqual(Array.from(read.visibility[k]), Array.from(written.visibility[k]), `visibility band ${k}`);
}
assert.deepEqual(Array.from(read.validity), Array.from(written.validity));
console.log("light cache: EEVEE's bake reads, the page's bake writes into Blender's cache");
