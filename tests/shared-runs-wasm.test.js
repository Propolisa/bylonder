// tags: runtime
// Runs of one package on one engine share its vertex streams (runtime/shared-resources.js, docs/notes/shared-runs.md):
// a second run uploads none; whatever one run writes leaves the other and the shared bytes as they were; disposing a
// run leaves the other drawing; a patch applied to two runs uploads its new streams once and lets go of the old ones.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Color3, NullEngine, VertexBuffer } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportPackage } from '../src/io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../src/io_scene_babylon/scene-patch.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
sync.view();
const made = await exportPackage(world), first = packageState(made), written = writePackage(made.files), { load } = await import(written.url);
// The package's own copy of the cache, which its scene.js loads with.
const { sharedStreams, sharedStatus } = await import(new URL('bylonder/shared-resources.js', written.url).href);
const engine = new NullEngine();
const run = async () => { const blend = await load(engine); await blend.settled(); blend.playhead.pause(); return blend; };

const digest = (data) => createHash('sha1').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const sharedBytes = () => sharedStreams(engine).buffers.map((buffer) => digest(buffer.getData()));
// What a run shows: its nodes' transforms, its materials' colors, its meshes' vertices (not the streams drawing
// gives a morphed mesh, position0 and on, which depend on what was drawn).
const shown = ({ scene }) => JSON.stringify([
  ...[...scene.meshes, ...scene.transformNodes].map((n) => [n.name, n.position.asArray(), n.rotation.asArray(), n.scaling.asArray()]),
  ...scene.materials.map((m) => [m.name, m.alpha, ...Object.values(m).filter((v) => v instanceof Color3).map((v) => v.asArray())]),
  ...scene.meshes.map((m) => (m.getVerticesDataKinds?.() ?? []).filter((kind) => !/\d$/.test(kind)).map((kind) => digest(m.getVerticesData(kind, true, true)))),
]);

const a = await run(), uploads = sharedStreams(engine).uploads;
const b = await run();
assert.ok(uploads > 0, 'a run draws shared streams');
assert.equal(sharedStreams(engine).uploads, uploads, 'a second run uploads none');
const before = { b: shown(b), shared: sharedBytes() };

// Run A writes all it reaches: transforms, materials, every stream, and deforms a mesh on the CPU.
for (const node of [...a.scene.meshes, ...a.scene.transformNodes]) { node.position.x += 1; node.scaling.scaleInPlace(2); }
for (const material of a.scene.materials) { material.alpha = 0.25; for (const value of Object.values(material)) if (value instanceof Color3) value.set(1, 0, 1); }
for (const mesh of a.scene.meshes) for (const kind of mesh.getVerticesDataKinds?.() ?? []) mesh.updateVerticesData(kind, new Float32Array(mesh.getVerticesData(kind).length).fill(7));
const body = a.scene.getMeshByName('Body'), rest = Float32Array.from(body.getVerticesData(VertexBuffer.PositionKind));
body.setVerticesData(VertexBuffer.PositionKind, rest, true);
body.updateVerticesData(VertexBuffer.PositionKind, rest.map((v) => v * 1.5));
a.scene.render();
assert.match(sharedStatus(a.scene), /^\d+ shared streams, 1 own live, 0 poisoned, 0 failed$/, sharedStatus(a.scene));
assert.equal(shown(b), before.b, 'run B is as it was');
assert.deepEqual(sharedBytes(), before.shared, 'the shared streams are as they were');

a.dispose();
assert.ok(b.scene.geometries.every((g) => Object.values(g.getVertexBuffers() ?? {}).every((vb) => vb.getBuffer())), "run B's buffers outlive run A");
b.scene.render();
assert.equal(shown(b), before.b);

// A patch moving the body's vertices, applied to two runs.
const c = await run();
for (const v of blendData().objects.get('Body').data.vertices) v.co = [v.co[0], v.co[1], v.co[2] + 0.01];
sync.view();
const patch = tablesPatch(first, packageState(await exportPackage(world))), used = sharedStreams(engine).used;
assert.ok(patch.tables.geometries, 'the patch changes a geometry');
await b.patch(patch);
const patched = sharedStreams(engine).uploads;
assert.ok(patched > uploads, 'its new streams are uploaded');
await c.patch(patch);
assert.equal(sharedStreams(engine).uploads, patched, 'once for both runs');
assert.equal(sharedStreams(engine).used, used, 'and the replaced ones let go of');
assert.equal(shown(b), shown(c));

b.dispose();
c.dispose();
written.remove();
process.exit(0);
