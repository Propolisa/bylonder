// Checks Snow's face playing the Bar Scene's acting (the "Acting" clip of the demo package) against Blender playing it
// on the shot's own rig, at the same frames, on each one's drawn head mesh: the mouth's opening (lower to upper lip
// vertex) and the jaw's (chin to nose tip vertex), in mm, each cheek's and the neck's vertex against Blender's, and the
// neck seam's gap (the widest of the head's open-edge vertices from the body vertex it touches at the first frame). Both are distances on the face, so the head's own motion and
// the two rigs' placement drop out; the two rigs' rest shows as an offset, so each is also given from its first frame.
//   usage: node tools/docs/acting-face-check.mjs <blender.json>  (acting-blender.py's rows: frame, mouth, jaw)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Matrix, NullEngine, Vector3, VertexBuffer } from '@babylonjs/core';
import { load } from '../../docs/demos/character-controller/world/scene.js';

const [shot] = process.argv.slice(2);
// Each point of the face by the bone at it.
const POINTS = { lower: 'DEF-OuterLip_Bot_Center', upper: 'DEF-OuterLip_Top0.L', chin: 'DEF-Chin', nose: 'DEF-Nose',
  cheekL: 'DEF-Cheek2_2.L', cheekR: 'DEF-Cheek2_2.R', neck: 'DEF-Neck' };
const measures = (at) => ({ mouth: Vector3.Distance(at.lower, at.upper), jaw: Vector3.Distance(at.chin, at.nose) });

// Blender's side, from the reference Blender (C:/Users/nifty/charscratch/acting-blender.py): its rows by frame.
const reference = JSON.parse(readFileSync(resolve(shot), 'utf8')), FRAMES = reference.rows.map((r) => r.frame), theirs = reference.rows;

// The page's side: the demo package, its Acting clip held at each frame (the clip starts at the action's first frame);
const page = await load(new NullEngine());
await page.settled();
const clip = page.clips().find((c) => c.name === 'Acting');
if (!clip) throw new Error('No Acting clip: export the demo from the file with the acting (BLEND=... export-demo.mjs)');
const group = clip.group, start = group.metadata.bylonder.frame_start, head = page.scene.getMeshByName('GEO-snow-head');
const body = page.scene.getMeshByName('GEO-snow-body');
// Skinned meshes' positions are in their skeleton's space, which the head and body share.
const world = (mesh) => { const p = mesh.getPositionData(true, true); return (i) => Vector3.FromArray(p, i * 3); };
const skeleton = head.skeleton ?? page.scene.skeletons[0];
// Its points: the head's vertices weighted most to those bones, as on Blender's side.
const sets = [[VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind], [VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind]]
  .map(([i, w]) => [head.getVerticesData(i), head.getVerticesData(w)]).filter(([i]) => i);
// Where Blender's side gives each point's face corner, the page draws that vertex there (one per corner, in order).
const pageVertex = reference.corner ?? Object.fromEntries(Object.entries(POINTS).map(([k, n]) => {
  const index = skeleton.bones.findIndex((b) => b.name === n);
  let best = -1, most = 0;
  for (const [indices, weights] of sets) for (let j = 0; j < indices.length; j++) if (indices[j] === index && weights[j] > most) { most = weights[j]; best = Math.floor(j / 4); }
  return [k, best];
}));
group.start(true);
group.pause();
const ours = [];
let partners;
for (const f of FRAMES) {
  group.goToFrame(f - start);
  // The rig's settings the clip keys, as the controller sets them while it plays.
  for (const [path, values] of Object.entries(group.metadata.bylonder.properties ?? {})) {
    try { page.set(path, typeof values === 'number' ? values : values[Math.min(values.length - 1, f - start)]); } catch { /* not a control of the page */ }
  }
  for (let i = 0; i < Number(process.env.RENDERS ?? 2); i++) { page.scene.render(); await page.settled(); }
  const p = head.getPositionData(true, true);
  const points = Object.fromEntries(Object.entries(pageVertex).map(([k, v]) => [k, Vector3.FromArray(p, v * 3)]));
  const [h, b] = [world(head), world(body)];
  // The body's vertices are not one per corner as Blender's: each head seam vertex's partner is the page's body vertex
  // nearest it at the first frame, as on Blender's side.
  partners ??= reference.seam?.head.map((c) => { let best = 0, d = Infinity; for (let i = 0; i < body.getTotalVertices(); i++) { const e = Vector3.Distance(h(c), b(i)); if (e < d) { d = e; best = i; } } return best; });
  const seam = reference.seam && reference.seam.head.map((c, i) => Vector3.Distance(h(c), b(partners[i])));
  ours.push({ ...measures(points), points, seam });
}

const mm = (v) => (v * 1000).toFixed(1).padStart(6);
console.log(`Blender vertices ${JSON.stringify(reference.vertex)}, page vertices ${JSON.stringify(pageVertex)}`);
const range = (rows, key) => { const v = rows.map((r) => r[key]); return `${mm(Math.min(...v))} to ${mm(Math.max(...v))}`; };
const corr = (key) => { const a = ours.map((r) => r[key]), b = theirs.map((r) => r[key]), ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
  let n = 0, da = 0, db = 0; a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; }); return (n / Math.sqrt(da * db)).toFixed(2); };
console.log(`mouth: page ${range(ours, 'mouth')}, Blender ${range(theirs, 'mouth')}, correlation over frames ${corr('mouth')}`);
console.log(`jaw:   page ${range(ours, 'jaw')}, Blender ${range(theirs, 'jaw')}, correlation over frames ${corr('jaw')}`);
console.log('frame | mouth opening page / Blender (change since first frame) | jaw, chin to nose page / Blender (change), mm');
FRAMES.forEach((f, k) => console.log(`${String(f).padStart(5)} | ${mm(ours[k].mouth)} / ${mm(theirs[k].mouth)} (${mm(ours[k].mouth - ours[0].mouth)} / ${mm(theirs[k].mouth - theirs[0].mouth)}) | ${mm(ours[k].jaw)} / ${mm(theirs[k].jaw)} (${mm(ours[k].jaw - ours[0].jaw)} / ${mm(theirs[k].jaw - theirs[0].jaw)})`));
// Each point's own path: how far it is from Blender's, in the head's object space (Blender's Y and Z swapped), worst over the frames.
if (theirs[0].local) for (const k of Object.keys(POINTS)) {
  const off = ours.map((o, i) => { const t = theirs[i].local[k]; return Vector3.Distance(o.points[k], new Vector3(t[0], t[2], t[1])); });
  console.log(`${k.padEnd(6)} vertex off Blender's: first frame ${mm(off[0])}, worst ${mm(Math.max(...off))} mm`);
  for (const i of [0, Math.floor(theirs.length / 2), theirs.length - 1]) console.log(`   frame ${theirs[i].frame} page ${ours[i].points[k].asArray().map((v) => mm(v)).join(',')} Blender ${[0, 2, 1].map((j) => mm(theirs[i].local[k][j])).join(',')}`);
}
if (reference.seam) {
  // Each pair's gap on the page against Blender's, worst over pairs and frames; and the seam's widest gap on each side.
  const worst = Math.max(...ours.flatMap((o, f) => o.seam.map((g, i) => Math.abs(g - theirs[f].seam[i]))));
  const widest = (gaps) => Math.max(...gaps), page = ours.map((o) => ({ seam: widest(o.seam) })), blender = theirs.map((t) => ({ seam: widest(t.seam) }));
  console.log(`neck seam (${reference.seam.head.length} head vertices on the body): widest gap page ${range(page, 'seam')}, Blender ${range(blender, 'seam')}; each gap off Blender's, worst ${mm(worst)} mm`);
}
process.exit(0);
