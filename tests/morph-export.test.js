// Morph targets in scene.bin (io_scene_babylon/morph-export.js and the page's MORPH_KEYS_SOURCE): a manager keeps its
// mesh's basis once and each target only the vertices it moves; the page rebuilds every target's arrays within the bounds a vertex counts as moved by.
import assert from 'node:assert/strict';
import { MorphTarget, MorphTargetManager, NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { binaryMorphTargets, MORPH_KEYS_SOURCE } from '../src/io_scene_babylon/morph-export.js';
import { createSceneBin } from '../src/io_scene_babylon/scene-bin.js';

const scene = new Scene(new NullEngine()), mesh = MeshBuilder.CreateSphere('Head', { segments: 16 }, scene);
const basis = mesh.getVerticesData('position'), normals = mesh.getVerticesData('normal');
const manager = new MorphTargetManager(scene);
// A key moving three vertices up, and one moving none.
const moved = Float32Array.from(basis), still = Float32Array.from(basis);
for (const v of [4, 9, 20]) moved[v * 3 + 1] += 0.05;
for (const [name, positions] of [['Smile', moved], ['Rest', still]]) {
  const target = new MorphTarget(name, 0, scene);
  target.setPositions(positions);
  target.setNormals(normals);
  manager.addTarget(target);
}
mesh.morphTargetManager = manager;
const serialized = manager.serialize(), bin = createSceneBin({ gzip: false });
const [written] = binaryMorphTargets([serialized], scene.meshes, bin);
assert.ok(written.bylonderBasis && written.targets.every((t) => t.bylonderSparse && !t.positions), 'targets as sparse offsets');
const bytes = bin.bytes(), buffers = bin.views.map(([offset, length, type]) => new ({ f32: Float32Array, u32: Uint32Array }[type])(bytes.buffer, bytes.byteOffset + offset, length));
assert.equal(buffers[written.targets[0].bylonderSparse.vertices].length, 3, 'the smile moves three vertices');
assert.equal(buffers[written.targets[1].bylonderSparse.vertices].length, 0, 'the rest key moves none');
const morphKeys = new Function(`${MORPH_KEYS_SOURCE}; return morphKeys;`)();
const rebuilt = morphKeys(structuredClone(written), buffers);
const near = (a, b, bound, what) => assert.ok(Array.from(a).every((v, i) => Math.abs(v - b[i]) <= bound), what);
near(rebuilt.targets[0].positions, serialized.targets[0].positions, 1e-5, 'positions rebuilt within a hundredth of a millimeter');
near(rebuilt.targets[1].normals, serialized.targets[1].normals, 1e-4, 'normals rebuilt within their bound');
const parsed = MorphTargetManager.Parse(rebuilt, scene);
assert.equal(parsed.numTargets, 2);
console.log(`Morph export: ${bytes.length} bytes for 2 targets of ${basis.length / 3} vertices against ${JSON.stringify(serialized).length} of JSON`);
