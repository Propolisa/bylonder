// A side-by-side picture of Preserve Volume (docs/runtimes.md): the Rigged Character's left elbow bent 130 degrees with
// its forearm twisted 90, and its left knee bent 120, posed by FK through the page's controls and alike in Main, as
// Blender deforms them (Main's evaluated mesh), as Babylon skinned them
// before (linear) and with dual quaternion skinning (runtime/dual-quaternion-skinning.js), all drawn by the exported
// page on WebGL 2 in Playwright's Chromium (one GPU slot). Writes .shots/character/skinning-compare.png.
//   usage: node tools/docs/compare-skinning.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from '../media.mjs';
import { chromium } from '../../tests/e2e/app.mjs';
import { servePackages } from '../../tests/export-parity/look.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = join(existsSync(join(root, '../bylonder/.shots')) ? join(root, '../bylonder/.shots') : join(root, '.shots'), 'character');
const FRAME = 1, SIZE = 360;
// The pose: the left arm in FK, its forearm bent then twisted; the left shin's IK off, bent. Quaternions (w, x, y, z).
const turn = (axis, degrees) => { const h = (degrees * Math.PI) / 360; return [Math.cos(h), ...axis.map((a) => a * Math.sin(h))]; };
const times = ([aw, ax, ay, az], [bw, bx, by, bz]) => [aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
const POSE = { 'forearm.L': times(turn([1, 0, 0], 130), turn([0, 1, 0], 90)), 'shin.L': turn([1, 0, 0], -120) };
const CONTROLS = [['objects["Rig"]["ik_fk.L"]', 0], ['objects["Rig"].pose.bones["shin.L"].constraints["IK"].influence', 0],
  ...Object.entries(POSE).flatMap(([bone, q]) => q.map((v, i) => [`objects["Rig"].pose.bones["${bone}"].rotation_quaternion[${i}]`, v]))];
const module = (path) => JSON.stringify(new URL(path, import.meta.url).href);
const dir = mkdtempSync(join(tmpdir(), 'bylonder-compare-'));
// The package, and Main's deform at the frame per Babylon vertex (a corner, Babylon's axes), with the joints' places.
const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { openExample } = await import(${module('../../tests/open-example.js')});
  const { packageFiles } = await import(${module('../../tests/export-package.js')});
  const { exportModule } = await import(${module('../../src/io_scene_babylon/js-export.js')});
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { world, sync, node } = openExample('rigged-character');
  sync.view();
  const files = packageFiles(await exportModule(world, { target: 'WEBGL2' }));
  for (const [path, data] of Object.entries(files)) { mkdirSync(dirname(join(${JSON.stringify(dir)}, path)), { recursive: true }); writeFileSync(join(${JSON.stringify(dir)}, path), data); }
  const { setCustomProperty } = await import(${module('../../src/blenkernel/animation/anim-blender.js')});
  const { blendData } = await import(${module('../../src/python/bpy_rna.js')});
  sync.frameChanged(${FRAME});
  const rig = blendData().objects.get('Rig'), pose = ${JSON.stringify(POSE)}, rigPointer = sync.objectOf(node('Rig'));
  for (const [bone, q] of Object.entries(pose)) rig.pose.bones.get(bone).rotation_quaternion = q;
  rig.pose.bones.get('shin.L').constraints.get('IK').influence = 0;
  setCustomProperty(rigPointer, 'ik_fk.L', 0);
  sync.blender.tag(rigPointer, 2);
  sync.frameChanged(${FRAME});
  const mesh = sync.blender.evaluatedMesh(sync.objectOf(node('Body'))), p = mesh.vert_positions, corners = mesh.corner_verts;
  const positions = Array.from({ length: mesh.corners_num }, (_, c) => [p[corners[c] * 3], p[corners[c] * 3 + 2], p[corners[c] * 3 + 1]]).flat();
  writeFileSync(join(${JSON.stringify(dir)}, 'main.json'), JSON.stringify({ positions }));
  process.exit(0);`], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (run.status !== 0) throw new Error('exporting rigged-character failed');
writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Compare</title><link rel="icon" href="data:,">
<style>html,body{margin:0;background:#000}canvas{width:${SIZE}px;height:${SIZE}px;display:block}</style>
<script type="importmap">{ "imports": { "@babylonjs/core/": "/core/" } }</script>
<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
import { packDualQuaternions, skinPoint, useDualQuaternionSkinning } from './bylonder/dual-quaternion-skinning.js';
import { HemisphericLight, Mesh, UniversalCamera, Vector3, VertexBuffer, VertexData } from '@babylonjs/core/index.js';
Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
const engine = await createEngine(document.getElementById('c')), blend = await load(engine), scene = blend.scene;
const main = await (await fetch('main.json')).json();
// The rig's constraints attach once their module loads, posing its bones as exported: the pose is set after.
await blend.settled();
blend.playhead.pause();
// The frame as the page's controls set it, so its live curves and constraints pose the rig for it.
blend.set(blend.controls().find((c) => c.path.endsWith('.frame_current')).path, ${FRAME});
for (const [path, value] of ${JSON.stringify(CONTROLS)}) blend.set(path, value);
// A few frames: the IK/FK switch's driver writes the IK influence after the pose it reads, so the arm settles on the next.
for (let i = 0; i < 3; i++) { scene.render(); await blend.settled(); }
const body = scene.meshes.find((m) => m.metadata?.bylonderDualQuaternions);
for (const m of scene.meshes) if (m !== body) m.isVisible = false;
// Blender's deform as a mesh of its own, placed and drawn as the body, smooth: corners at one place share a normal.
const blender = new Mesh('blender', scene), data = new VertexData(), faceted = [], normals = new Array(main.positions.length).fill(0), byPlace = new Map();
VertexData.ComputeNormals(main.positions, body.getIndices(), faceted);
for (let c = 0; c < main.positions.length / 3; c++) {
  const key = main.positions.slice(c * 3, c * 3 + 3).map((v) => v.toFixed(5)).join(), sum = byPlace.get(key) ?? byPlace.set(key, [0, 0, 0]).get(key);
  for (let i = 0; i < 3; i++) sum[i] += faceted[c * 3 + i];
}
for (let c = 0; c < main.positions.length / 3; c++) {
  const sum = byPlace.get(main.positions.slice(c * 3, c * 3 + 3).map((v) => v.toFixed(5)).join()), n = Math.hypot(...sum) || 1;
  for (let i = 0; i < 3; i++) normals[c * 3 + i] = sum[i] / n;
}
Object.assign(data, { positions: main.positions, indices: body.getIndices(), normals });
data.applyToMesh(blender);
blender.parent = body.parent;
blender.position.copyFrom(body.position);
blender.rotation.copyFrom(body.rotation);
blender.rotationQuaternion = body.rotationQuaternion?.clone() ?? null;
blender.scaling.copyFrom(body.scaling);
blender.material = body.material;
// Close up, looking as the scene's camera looks.
const toward = scene.activeCamera.getForwardRay(1).direction.clone(), camera = new UniversalCamera('close', toward.clone(), scene);
camera.minZ = 0.01;
scene.activeCamera = camera;
// A light from the camera's side, so a joint in the scene's shadow reads.
new HemisphericLight('fill', toward.scale(-1), scene).intensity = 0.6;
// The joints as the page poses them, the heads of the forearm and the shin: the elbow seen as the scene's camera sees
// it, the knee from its outer side.
const JOINTS = { elbow: ['forearm.L', toward], knee: ['shin.L', new Vector3(-1, 0, 0)] };
// How far Blender's mesh is from the body skinned by the module's CPU reference, in the world: 0 when the page is posed
// as Main is and the Blender mesh is placed as the body.
window.offset = () => {
  const pos = body.getVerticesData(VertexBuffer.PositionKind), packed = packDualQuaternions(body.skeleton.getTransformMatrices(body)), world = body.computeWorldMatrix(true);
  const I = [VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesIndicesExtraKind].map((k) => body.getVerticesData(k)), W = [VertexBuffer.MatricesWeightsKind, VertexBuffer.MatricesWeightsExtraKind].map((k) => body.getVerticesData(k));
  const targets = Array.from({ length: body.morphTargetManager?.numTargets ?? 0 }, (_, t) => body.morphTargetManager.getTarget(t)).filter((t) => t.influence);
  let worst = 0;
  for (let c = 0; c < pos.length / 3; c++) {
    const inf = [];
    for (let k = 0; k < body.numBoneInfluencers; k++) if (W[k >> 2]?.[c * 4 + (k & 3)]) inf.push([I[k >> 2][c * 4 + (k & 3)], W[k >> 2][c * 4 + (k & 3)]]);
    const q = [0, 1, 2].map((i) => targets.reduce((v, t) => v + (t.getPositions()[c * 3 + i] - pos[c * 3 + i]) * t.influence, pos[c * 3 + i]));
    const ours = Vector3.TransformCoordinates(Vector3.FromArray(skinPoint(packed, inf, q)), world);
    const theirs = Vector3.TransformCoordinates(Vector3.FromArray(main.positions, c * 3), blender.computeWorldMatrix(true));
    worst = Math.max(worst, Vector3.Distance(ours, theirs));
  }
  return worst;
};
window.show = async (joint, kind) => {
  const [bone, direction] = JOINTS[joint], at = body.skeleton.bones.find((b) => b.name === bone).getAbsolutePosition(body);
  camera.position = at.subtract(direction.scale(0.45));
  camera.setTarget(at);
  blender.isVisible = kind === 'blender';
  body.isVisible = kind !== 'blender';
  useDualQuaternionSkinning(body, kind === 'dqs');
  scene.render();
  await scene.whenReadyAsync();
  for (let i = 0; i < 3; i++) scene.render();
};
window.ready = true;
</script>`);
const server = servePackages(dir);
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  await page.goto(server.url('index.html'));
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  console.log('Blender mesh to dual quaternion skinning, at most', await page.evaluate(() => window.offset()));
  const shots = [];
  for (const joint of ['elbow', 'knee']) for (const kind of ['blender', 'linear', 'dqs']) {
    await page.evaluate(([j, k]) => window.show(j, k), [joint, kind]);
    const path = join(dir, `${joint}-${kind}.png`);
    await page.screenshot({ path });
    shots.push(path);
  }
  // Three columns (Blender, Babylon linear, Babylon dual quaternions), a row per joint, each labelled.
  const font = process.platform === 'win32' ? 'C\\:/Windows/Fonts/arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const labels = ['Blender Preserve Volume', 'Babylon linear (before)', 'Babylon dual quaternions'];
  const filters = shots.map((_, i) => `[${i}:v]drawtext=fontfile='${font}':text='${labels[i % 3]}':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5[v${i}]`);
  const out = join(SHOTS, 'skinning-compare.png');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...shots.flatMap((s) => ['-i', s]), '-filter_complex',
    `${filters.join(';')};[v0][v1][v2]hstack=3[top];[v3][v4][v5]hstack=3[bottom];[top][bottom]vstack=2`, out]);
  console.log(out);
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
