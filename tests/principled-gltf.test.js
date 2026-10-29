// A Principled BSDF as a PBRMaterial (src/blenkernel/material/principled-gltf.js): the exporter half writes the glTF
// material Blender's own exporter writes for the same inputs (tests/fixtures/materials-gltf.json, from
// tools/blender-reference/material-fixtures.py), and the loader half sets what Babylon's glTF loader sets loading it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, SceneLoader, PBRMaterial } from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/index.js';
import { principledGltf, gltfPBR, principledPBR, applyPBR, differencesPBR } from '../src/blenkernel/material/principled-gltf.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/materials-gltf.json', import.meta.url), 'utf8'));
const close = (a, b, path = '') => {
  if (typeof a === 'number') return assert(Math.abs(a - b) < 1e-5, `${path}: ${a}, Blender's ${b}`);
  assert.equal(typeof a, typeof b, `${path}: ${JSON.stringify(a)}, Blender's ${JSON.stringify(b)}`);
  if (typeof a !== 'object') return assert.equal(a, b, path);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: ${JSON.stringify(a)}, Blender's ${JSON.stringify(b)}`);
  for (const key of Object.keys(a)) close(a[key], b[key], `${path}.${key}`);
};
for (const [name, { inputs, use_backface_culling, gltf }] of Object.entries(cases)) close(principledGltf(inputs, { use_backface_culling }), gltf, name);

// Babylon's loader on a glTF of one triangle per case, each with its material.
const engine = new NullEngine(), scene = new Scene(engine);
const triangle = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64');
const materials = Object.values(cases).map(({ gltf }, index) => ({ ...gltf, name: `m${index}` }));
const asset = {
  asset: { version: '2.0' },
  extensionsUsed: [...new Set(materials.flatMap((m) => Object.keys(m.extensions ?? {})))],
  buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${triangle}` }],
  bufferViews: [{ buffer: 0, byteLength: 36 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  meshes: materials.map((m, index) => ({ primitives: [{ attributes: { POSITION: 0 }, material: index }] })),
  nodes: materials.map((m, index) => ({ mesh: index })),
  scenes: [{ nodes: materials.map((m, index) => index) }],
  materials,
};
await SceneLoader.AppendAsync('', `data:${JSON.stringify(asset)}`, scene, undefined, '.gltf');
materials.forEach((gltf, index) => {
  const loaded = scene.materials.find((m) => m.name === `m${index}`);
  assert.deepEqual(differencesPBR(loaded, gltfPBR(gltf)), [], `${Object.keys(cases)[index]}: as Babylon's loader loads it`);
});

// Composed and applied over a material drawn before, every property is drawn again.
const material = new PBRMaterial('drawn', scene);
applyPBR(material, principledPBR(cases.layers.inputs, cases.layers));
applyPBR(material, principledPBR(cases.red.inputs, cases.red));
assert.deepEqual(differencesPBR(material, principledPBR(cases.red.inputs, cases.red)), []);
assert(!material.clearCoat.isEnabled && !material.sheen.isEnabled && !material.subSurface.isRefractionEnabled, 'the layers are gone with the extensions');
console.log(`Principled BSDF as PBRMaterial: ${Object.keys(cases).length} materials as Blender's glTF exporter writes them and Babylon's loader reads them`);
