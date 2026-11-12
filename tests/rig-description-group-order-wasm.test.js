// A mesh whose Armature modifier preserves volume carries each vertex's group indices in its weight list's order into
// its rig description (rig-description.js `vertex_group_order`), which Blender's dual-quaternion blend follows, packed
// and read back as the page's runtime reads it; a mesh without Preserve Volume carries none.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { packDescription, rigDescription } from '../src/io_scene_babylon/rig-description.js';
import { unpackDescription } from '../src/io_scene_babylon/runtime/native-rig.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const rig = blendData().objects.get('Rig'), body = blendData().objects.get('Body');
// A vertex in two groups or more, taken out of its first group and put back, which lists that group last.
const at = [...body.data.vertices].findIndex((v) => v.groups.length > 1), first = body.data.vertices[at].groups[0];
const group = body.vertex_groups[first.group], weight = first.weight;
group.remove([at]);
group.add([at], weight, 'REPLACE');
sync.view();
const stored = [...body.data.vertices].map((v) => [...v.groups].map((g) => g.group));
assert.notDeepEqual(stored[at], [...stored[at]].sort((a, b) => a - b), 'the vertex lists its groups out of index order');

const key = sync.objectOf(world.objects.find((n) => n.name === 'Body'));
const describe = () => rigDescription(rig, [body], () => sync.blender.mesh(key));
const orderOf = (data) => Array.from({ length: data.vertex_group_order.offsets.length - 1 },
  (_, v) => Array.from(data.vertex_group_order.indices.subarray(data.vertex_group_order.offsets[v], data.vertex_group_order.offsets[v + 1])));
const described = describe().objects.find((o) => o.name === 'Body').data;
assert.deepEqual(orderOf(described), stored, "every vertex's groups in its weight list's order");

const { packed, arrays } = packDescription(describe());
// The `{ array }` references back to their arrays, as the page's scheduler resolves them.
const resolve = (value) => (Array.isArray(value) ? value.map(resolve) : value?.array !== undefined ? arrays[value.array]
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value);
const read = unpackDescription(resolve(packed)).objects.find((o) => o.name === 'Body').data;
assert.deepEqual(orderOf(read), stored, 'packed and read back');

body.modifiers.get('Armature').use_deform_preserve_volume = false;
assert.equal(describe().objects.find((o) => o.name === 'Body').data.vertex_group_order, undefined, 'none without Preserve Volume');
console.log("Rig description: a Preserve Volume mesh carries each vertex's group order (a vertex listing its groups out of index order)");
process.exit(0);
