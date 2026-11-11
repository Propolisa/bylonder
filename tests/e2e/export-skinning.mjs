// Dual quaternion skinning on the GPU (one slot: ask the coordinator first): the Rigged Character's exported page, its
// body under Preserve Volume, read back from Chromium on WebGL 2 (and WebGPU with E2E_ENGINE=webgpu). Its silhouette
// skinned by the GPU, with a node material (its BonesBlock swapped) and a Standard material (the plugin), against
// the same mesh skinned on the CPU by the module's reference math (dual-quaternion-skinning.js skinPoint), which the
// armature test checks against Blender's deform; and, to show the check tells them apart, against linear skinning.
//   node tests/e2e/export-skinning.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './app.mjs';
import { E2E_ENGINE } from './tools.mjs';
import { servePackages } from '../export-parity/look.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const module = (path) => JSON.stringify(new URL(path, import.meta.url).href);
const dir = mkdtempSync(join(tmpdir(), 'bylonder-skinning-'));
// The package, exported in a process of its own (Blender's module holds one Main).
const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { openExample } = await import(${module('../open-example.js')});
  const { packageFiles } = await import(${module('../export-package.js')});
  const { exportModule } = await import(${module('../../src/io_scene_babylon/js-export.js')});
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { world, sync } = openExample('rigged-character');
  sync.view();
  const files = packageFiles(await exportModule(world, { target: 'WEBGL2' }));
  for (const [path, data] of Object.entries(files)) { mkdirSync(dirname(join(${JSON.stringify(dir)}, path)), { recursive: true }); writeFileSync(join(${JSON.stringify(dir)}, path), data); }
  process.exit(0);`], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
assert.equal(run.status, 0, 'the export');
writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Skinning</title><link rel="icon" href="data:,">
<style>html,body{margin:0;background:#000}canvas{width:640px;height:640px;display:block}</style>
<script type="importmap">{ "imports": { "@babylonjs/core/": "/core/" } }</script>
<canvas id="c" width="640" height="640"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
import { packDualQuaternions, skinPoint, useDualQuaternionSkinning } from './bylonder/dual-quaternion-skinning.js';
import { BonesBlock, Color3, FragmentOutputBlock, InputBlock, Mesh, MorphTargetsBlock, NodeMaterial, NodeMaterialSystemValues, StandardMaterial, TransformBlock, VertexBuffer, VertexData, VertexOutputBlock } from '@babylonjs/core/index.js';
if (!new URLSearchParams(location.search).has('webgpu')) Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
const engine = await createEngine(document.getElementById('c')), blend = await load(engine), scene = blend.scene;
blend.playhead.pause();
// The crouch: knees and the left elbow bent.
blend.playhead.seek(40);
const body = scene.meshes.find((m) => m.metadata?.bylonderDualQuaternions);
const flat = new StandardMaterial('flat', scene);
Object.assign(flat, { disableLighting: true, emissiveColor: Color3.White() });
const pixels = async () => { scene.render(); await scene.whenReadyAsync(); scene.render(); return engine.readPixels(0, 0, 640, 640); };
// A white node material of Babylon's blocks, morphed then skinned: its BonesBlock swapped for the dual quaternions'.
function nodeFlat() {
  const material = new NodeMaterial('node flat', scene), input = (name, set) => { const b = new InputBlock(name); set(b); return b; };
  const position = input('position', (b) => b.setAsAttribute('position')), morph = new MorphTargetsBlock('morph'), bones = new BonesBlock('bones');
  position.output.connectTo(morph.position);
  input('world', (b) => b.setAsSystemValue(NodeMaterialSystemValues.World)).output.connectTo(bones.world);
  const world = new TransformBlock('world position'), clip = new TransformBlock('clip position'), vertex = new VertexOutputBlock('vertex'), fragment = new FragmentOutputBlock('fragment');
  morph.positionOutput.connectTo(world.vector);
  bones.output.connectTo(world.transform);
  world.output.connectTo(clip.vector);
  input('viewProjection', (b) => b.setAsSystemValue(NodeMaterialSystemValues.ViewProjection)).output.connectTo(clip.transform);
  clip.output.connectTo(vertex.vector);
  input('color', (b) => { b.value = Color3.White(); }).output.connectTo(fragment.rgb);
  material.addOutputNode(vertex);
  material.addOutputNode(fragment);
  morph.autoConfigure(material);
  bones.autoConfigure(material);
  material.build();
  return material;
}
// Coverage of the drawn picture: 1 where it differs from the background alone.
let background;
const mask = async () => { const p = await pixels(); return Array.from({ length: p.length / 4 }, (_, i) => +(Math.abs(p[i * 4] - background[i * 4]) + Math.abs(p[i * 4 + 1] - background[i * 4 + 1]) + Math.abs(p[i * 4 + 2] - background[i * 4 + 2]) > 24)); };
const differ = (a, b) => a.reduce((n, v, i) => n + (v !== b[i]), 0);
// The body skinned on the CPU, dual quaternions or linear, as a mesh of its own.
function cpu(linear, material) {
  const pos = body.getVerticesData(VertexBuffer.PositionKind), matrices = body.skeleton.getTransformMatrices(body), packed = packDualQuaternions(matrices);
  const I = [VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesIndicesExtraKind].map((k) => body.getVerticesData(k));
  const W = [VertexBuffer.MatricesWeightsKind, VertexBuffer.MatricesWeightsExtraKind].map((k) => body.getVerticesData(k));
  const morph = body.morphTargetManager, targets = Array.from({ length: morph?.numTargets ?? 0 }, (_, t) => morph.getTarget(t)).filter((t) => t.influence);
  const out = new Float32Array(pos.length);
  for (let c = 0; c < pos.length / 3; c++) {
    const inf = [];
    for (let k = 0; k < body.numBoneInfluencers; k++) if (W[k >> 2]?.[c * 4 + (k & 3)]) inf.push([I[k >> 2][c * 4 + (k & 3)], W[k >> 2][c * 4 + (k & 3)]]);
    const p = [0, 1, 2].map((i) => targets.reduce((v, t) => v + (t.getPositions()[c * 3 + i] - pos[c * 3 + i]) * t.influence, pos[c * 3 + i]));
    const s = linear ? [0, 1, 2].map((r) => inf.reduce((v, [b, w]) => v + w * (matrices[b * 16 + r] * p[0] + matrices[b * 16 + 4 + r] * p[1] + matrices[b * 16 + 8 + r] * p[2] + matrices[b * 16 + 12 + r]), 0)) : skinPoint(packed, inf, p);
    out.set(s, c * 3);
  }
  const mesh = new Mesh('cpu', scene), data = new VertexData();
  const normals = [];
  VertexData.ComputeNormals(out, body.getIndices(), normals);
  Object.assign(data, { positions: out, indices: body.getIndices(), normals });
  data.applyToMesh(mesh);
  mesh.parent = body.parent;
  mesh.position.copyFrom(body.position); mesh.rotationQuaternion = body.rotationQuaternion?.clone() ?? null; mesh.rotation.copyFrom(body.rotation); mesh.scaling.copyFrom(body.scaling);
  mesh.material = material;
  return mesh;
}
window.check = async () => {
  for (const m of scene.meshes) if (m !== body) m.isVisible = false;
  // The picture as drawn, without the post-processes that change it from frame to frame.
  scene.postProcessesEnabled = false;
  body.isVisible = false;
  background = await pixels();
  body.isVisible = true;
  const material = body.material;
  body.material = nodeFlat();
  useDualQuaternionSkinning(body, true);
  const node = await mask();
  body.material = flat;
  const plugin = await mask();
  body.isVisible = false;
  const reference = cpu(false, flat), dual = await mask();
  reference.dispose();
  const lbs = cpu(true, flat), linear = await mask();
  lbs.dispose();
  body.material = material;
  body.isVisible = true;
  return { drawn: dual.reduce((a, b) => a + b, 0), node: differ(node, dual), plugin: differ(plugin, dual), linear: differ(linear, dual), engine: engine.name ?? engine.description };
};
window.ready = true;
</script>`);
const server = servePackages(dir);
const browser = await chromium.launch();
try {
  for (const webgpu of E2E_ENGINE ? [false, true] : [false]) {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } }), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(server.url(`index.html${webgpu ? '?webgpu' : ''}`));
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
    const result = await page.evaluate(() => window.check());
    const label = webgpu ? 'WebGPU' : 'WebGL 2';
    assert.deepEqual(errors, [], `${label}: no errors`);
    assert.ok(result.drawn > 5000, `${label}: the body is drawn (${result.drawn} pixels)`);
    // A pixel or two may differ where the rasterizer rounds an edge differently.
    for (const kind of ['node', 'plugin']) assert.ok(result[kind] < result.drawn * 0.002, `${label}: the ${kind} material's GPU skinning is the CPU reference (${result[kind]} pixels differ)`);
    assert.ok(result.linear > Math.max(result.node, result.plugin) * 4, `${label}: linear skinning differs more (${result.linear} pixels)`);
    console.log(`Dual quaternion skinning, ${label}: node material ${result.node}, plugin ${result.plugin}, linear ${result.linear} of ${result.drawn} pixels differ from the CPU reference`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
