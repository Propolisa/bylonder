// The IR's relation gaps (docs/licence-free-live.md, Relation gaps) on the examples: what a walk of ID pointers does not
// see, and which of it the depsgraph's relations (deg-relations.cc), added to the IR's references, close. Kinds: `time`
// (a driver reading `frame`, a Scene Time node, an image sequence), `camera` (the scene's active camera read through the
// context), `view-layer` (a collection excluded in a view layer, an Is Viewport node), `info-link` (an Object or
// Collection Info node given its ID by a link), `self` (Self Object). What stays open is listed per example.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The examples whose .blend has relations a pointer walk misses (Blender's demo files are not checked here), and those
// the IR's references still miss once the depsgraph's are in them.
const GAPS = {
  'geometry-node-editor': ['view-layer'],
  'geometry-nodes': ['view-layer'],
  'hair-dynamics': ['info-link', 'self', 'view-layer'],
};
const OPEN = {
  'geometry-node-editor': ['view-layer'],
  'geometry-nodes': ['view-layer'],
  'hair-dynamics': ['view-layer'],
};
// What only the view layer says (an excluded collection, Is Viewport) is not a relation between IDs: it stays open.
// The other kinds close once every depsgraph relation between carried IDs is one of the IR's references.
const BETWEEN_IDS = ['time', 'camera', 'info-link', 'self'];

// One example's gaps, in a process of its own (Blender's module holds one Main).
async function gapsOf(id) {
  const { openExample } = await import('./open-example.js');
  const { blendData } = await import('../src/python/bpy_rna.js');
  const { writeGraph } = await import('../src/io_scene_babylon/ir-graphs.js');
  const { exportIDs, rootIDs, depsgraphReferences } = await import('../src/io_scene_babylon/ir-export.js');
  const { ID_OB } = await import('../src/blenkernel/main-evaluated.js');
  const { sync } = openExample(id);
  sync.view();
  const data = blendData(), graphs = {}, gaps = new Set();
  const trees = [...[...data.node_groups].map((tree) => [tree, `NT:${tree.name}`]),
    ...[...data.materials, ...data.worlds].filter((owner) => owner.node_tree).map((owner) => [owner.node_tree, `${owner.name}/node_tree`])];
  for (const [tree, key] of trees) {
    try {
      writeGraph(tree, key, graphs);
    } catch (error) {
      console.error(`${id}: ${key} is not written (${error.message})`);
    }
  }
  for (const graph of Object.values(graphs)) for (const node of graph.nodes) {
    const linked = (socket) => graph.links.some(([, , to, input]) => to === node.name && input === socket);
    if (['node:GeometryNodeInputSceneTime', 'node:CompositorNodeSceneTime'].includes(node.type) || node.settings.image?.source === 'SEQUENCE') gaps.add('time');
    if (node.type === 'node:GeometryNodeInputActiveCamera') gaps.add('camera');
    if (node.type === 'node:GeometryNodeIsViewport') gaps.add('view-layer');
    if (node.type === 'node:GeometryNodeSelfObject') gaps.add('self');
    if ((node.type === 'node:GeometryNodeObjectInfo' && linked('Object')) || (node.type === 'node:GeometryNodeCollectionInfo' && linked('Collection'))) gaps.add('info-link');
  }
  const ids = ['objects', 'materials', 'worlds', 'scenes', 'meshes', 'shape_keys', 'lights', 'cameras'].flatMap((name) => [...(data[name] ?? [])]);
  for (const id of ids) for (const fc of id.animation_data?.drivers ?? []) {
    if (fc.driver.type === 'SCRIPTED' && /\bframe\b/.test(fc.driver.expression)) gaps.add('time');
    if ([...fc.driver.variables].some((v) => v.type === 'CONTEXT_PROP')) gaps.add('camera');
  }
  const excluded = (layer) => layer.exclude || [...layer.children].some(excluded);
  for (const scene of data.scenes) for (const layer of scene.view_layers) if ([...layer.layer_collection.children].some(excluded)) gaps.add('view-layer');
  const carried = exportIDs(rootIDs(sync.blender.ids(ID_OB)));
  const relations = sync.blender.relations();
  if (!relations) return { gaps: [...gaps].sort(), open: null };
  const references = [...carried.references, ...depsgraphReferences(carried.ids, carried.references, relations)];
  const held = ({ from, to }) => !(from === 'time' || carried.ids[from]) || !carried.ids[to] || references.some((r) => r.from === to && r.to === from || r.from === from && r.to === to);
  const closed = relations.every(held);
  return { gaps: [...gaps].sort(), open: [...gaps].filter((kind) => !closed || !BETWEEN_IDS.includes(kind)).sort() };
}

const id = process.argv[2];
if (id) console.log(JSON.stringify(await gapsOf(id)));
else {
  const examples = readdirSync(new URL('../examples/', import.meta.url)).filter((name) => existsSync(new URL(`../examples/${name}/${name}.blend`, import.meta.url)));
  const found = Object.fromEntries(examples.map((name) => [name, JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').at(-1))]));
  const listed = (key) => Object.fromEntries(Object.entries(found).filter(([name, kinds]) => kinds[key]?.length || GAPS[name]).map(([name, kinds]) => [name, kinds[key]]));
  const expected = (table) => Object.fromEntries(Object.entries(table).filter(([name]) => found[name]));
  assert.deepEqual(listed('gaps'), expected(GAPS), `relation gaps changed: ${JSON.stringify(listed('gaps'))}`);
  const withRelations = Object.values(found).every((kinds) => kinds.open);
  if (withRelations) assert.deepEqual(listed('open'), expected(OPEN), `gaps the depsgraph's relations leave open changed: ${JSON.stringify(listed('open'))}`);
  const describe = (key) => Object.entries(listed(key)).filter(([, g]) => g.length).map(([n, g]) => `${n} (${g.join(', ')})`).join('; ');
  console.log(`IR relations: ${Object.values(found).filter((kinds) => kinds.gaps.length).length} of ${examples.length} examples have relations a pointer walk misses: ${describe('gaps')}; ${
    withRelations ? `with the depsgraph's relations in the IR, open: ${describe('open')}` : 'this module has no depsgraph relations (deg-relations.cc) to close them'}`);
}
