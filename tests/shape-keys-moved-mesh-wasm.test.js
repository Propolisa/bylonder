// A mesh with shape keys whose vertices a script moved through RNA (not in Edit Mode), so its positions are no longer
// Basis: Blender evaluates it from its keys all the same (Basis, not the Mesh's positions), and so do the view and
// the export: the node draws Basis with Basis's normals, and the keys stay morph targets with their controls.
import assert from 'node:assert/strict';
import { VertexBuffer } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const body = blendData().objects.get('Body'), node = world.objects.find((n) => n.name === 'Body');
sync.view();
const drawn = () => [VertexBuffer.PositionKind, VertexBuffer.NormalKind].map((kind) => Array.from(node.getVerticesData(kind)));
const [positions, normals] = drawn();
const keyControls = async () => Object.keys(JSON.parse((await exportModule(world))['scene.ir.json']).properties).filter((path) => path.startsWith('shape_keys'));
const before = await keyControls();
assert.ok(before.length, 'the keys have controls');

for (const v of body.data.vertices) v.co = [v.co[0], v.co[1], v.co[2] + 0.01];
body.data.update();
sync.view();
const basis = body.data.shape_keys.key_blocks[0].data[0].co;
assert.ok(Math.abs(body.data.vertices[0].co[2] - basis[2] - 0.01) < 1e-6, 'Main moved the Mesh, not Basis');
const [movedPositions, movedNormals] = drawn();
const farthest = (a, b) => a.reduce((worst, x, i) => Math.max(worst, Math.abs(x - b[i])), 0);
assert.ok(farthest(movedPositions, positions) < 1e-6, `the node draws Basis, as Blender evaluates (${farthest(movedPositions, positions)})`);
assert.ok(farthest(movedNormals, normals) < 1e-5, `with Basis's normals (${farthest(movedNormals, normals)})`);
assert.deepEqual(await keyControls(), before, 'the export keeps the keys');
console.log('Shape keys moved mesh: a mesh moved off Basis through RNA draws and exports from Basis, as Blender evaluates it');
process.exit(0);
