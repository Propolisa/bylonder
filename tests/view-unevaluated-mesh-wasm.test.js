// A mesh object Main gives no evaluated mesh for (its depsgraph left it out) keeps a geometry when the view draws it
// again (main-view.js drawGeometry): it is drawn from its own Mesh, never as nothing, so an export that samples frames
// never writes it empty; vertex buffers of its evaluated topology that its own Mesh does not fill go (mesh-batch-cache.js).
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const body = blendData().objects.get('Body'), node = world.objects.find((n) => n.name === 'Body');
// A level of subdivision, so the evaluated mesh has more corners than the object's own Mesh.
body.modifiers.new('Subdivision', 'SUBSURF').levels = 1;
sync.view();
const evaluated = node.getTotalVertices(), own = body.data.loops.length;
assert.ok(evaluated > own, 'the evaluated mesh has more vertices than its own Mesh');
// Main leaves the object out of its evaluation, and its geometry is tagged changed, as an export's frames tag it.
const ob = sync.objectOf(node), evaluatedMesh = sync.blender.evaluatedMesh.bind(sync.blender);
sync.blender.evaluatedMesh = (o) => (o === ob ? null : evaluatedMesh(o));
sync.blender.tag(ob, 2);
sync.view();
assert.equal(node.getTotalVertices(), own, 'drawn from its own Mesh, a vertex per face corner, not empty');
for (const kind of node.getVerticesDataKinds()) assert.ok(node.getVerticesData(kind).length >= own, `${kind} holds a value per vertex`);
console.log(`View: a mesh Main left unevaluated is drawn from its own Mesh (${own} vertices), not empty`);
process.exit(0);
