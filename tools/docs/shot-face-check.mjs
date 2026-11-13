// Checks a shot's exported face against Blender: the shot file open as Main and its package (tools/docs/export-shot.mjs)
// loaded in Node, both at the same frames; for the head mesh, the largest distance of a drawn vertex from Main's
// evaluated one (mm), and the mouth's opening (lower to upper lip vertex) in each, so the performance shows.
//   usage: node tools/docs/shot-face-check.mjs <shot.blend> <package folder> [head mesh] [frames, comma separated]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NullEngine, Vector3, VertexBuffer } from '@babylonjs/core';
import { openExample } from '../../tests/open-example.js';

const [blend, dir, HEAD = 'GEO-snow-head', list = '1,40,80,120,160,200,240'] = process.argv.slice(2);
const FRAMES = list.split(',').map(Number);
const LIPS = { lower: 'DEF-OuterLip_Bot_Center', upper: 'DEF-OuterLip_Top0.L' };

const { world, sync } = openExample(resolve(blend));
sync.view();
const mainHead = world.objects.find((n) => n.name === HEAD);
// Main's evaluated head as the page draws it: a vertex per face corner, then each loose edge's ends, in Babylon's axes.
const mainVertices = () => {
  const mesh = sync.blender.evaluatedMesh(sync.objectOf(mainHead)), p = mesh.vert_positions;
  const drawn = [...mesh.corner_verts, ...Array.from(mesh.loose_edges()).flatMap((e) => [mesh.edges[e * 2], mesh.edges[e * 2 + 1]])];
  return Float32Array.from(drawn.flatMap((v) => [p[v * 3], p[v * 3 + 2], p[v * 3 + 1]]));
};

const page = await (await import(pathToFileURL(resolve(dir, 'scene.js')).href)).load(new NullEngine());
await page.settled();
page.playhead.pause();
const frame = page.controls().find((c) => c.path.endsWith('.frame_current')).path;
const head = page.scene.getMeshByName(HEAD);
const pageVertices = () => (head.skeleton ? head.getPositionData(true, true) : head.getVerticesData(VertexBuffer.PositionKind));
// The lip vertices: the head's most weighted to each lip bone.
const skeleton = head.skeleton ?? page.scene.skeletons[0];
const vertexOf = (bone) => {
  const index = skeleton.bones.findIndex((b) => b.name === bone), sets = [[VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind], [VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind]]
    .map(([i, w]) => [head.getVerticesData(i), head.getVerticesData(w)]).filter(([i]) => i);
  let best = -1, most = 0;
  for (const [indices, weights] of sets) for (let k = 0; k < indices.length; k++) if (indices[k] === index && weights[k] > most) { most = weights[k]; best = Math.floor(k / 4); }
  return best;
};
const lower = vertexOf(LIPS.lower), upper = vertexOf(LIPS.upper);
const gap = (p) => Vector3.Distance(Vector3.FromArray(p, lower * 3), Vector3.FromArray(p, upper * 3)) * 1000;
console.log(`${HEAD}: ${head.getTotalVertices()} drawn vertices, ${head.skeleton ? 'skinned by Babylon' : 'deformed by the runtime or static'}; lip vertices ${lower}, ${upper}`);
for (const f of FRAMES) {
  page.set(frame, f);
  for (let i = 0; i < 2; i++) { page.scene.render(); await page.settled(); }
  sync.frameChanged(f);
  const ours = pageVertices(), theirs = mainVertices();
  let worst = 0;
  for (let k = 0; k < Math.min(ours.length, theirs.length); k += 3) worst = Math.max(worst, Math.hypot(ours[k] - theirs[k], ours[k + 1] - theirs[k + 1], ours[k + 2] - theirs[k + 2]));
  console.log(`frame ${String(f).padStart(3)}: page against Blender worst ${(worst * 1000).toFixed(2)} mm${ours.length !== theirs.length ? ` (vertex counts ${ours.length / 3} and ${theirs.length / 3})` : ''}; mouth opening page ${gap(ours).toFixed(1)} mm, Blender ${gap(theirs).toFixed(1)} mm`);
}
process.exit(0);
