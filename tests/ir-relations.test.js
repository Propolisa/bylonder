// The IR's relation gaps (docs/licence-free-live.md, Relation gaps) on the examples: what a walk of ID pointers does not
// see, listed per example so the gap stays visible until a depsgraph relations seam closes it. Kinds: `time` (a driver
// reading `frame`, a Scene Time node, an image sequence), `camera` (the scene's active camera read through the
// context), `view-layer` (a collection excluded in a view layer, an Is Viewport node), `info-link` (an Object or
// Collection Info node given its ID by a link), `self` (Self Object).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The examples whose .blend has relations the IR's references miss (Blender's demo files are not checked here).
const GAPS = {
  'geometry-node-editor': ['view-layer'],
  'geometry-nodes': ['view-layer'],
  'hair-dynamics': ['info-link', 'self', 'view-layer'],
};

// One example's gaps, in a process of its own (Blender's module holds one Main).
async function gapsOf(id) {
  const { openExample } = await import('./open-example.js');
  const { blendData } = await import('../src/python/bpy_rna.js');
  const { writeGraph } = await import('../src/io_scene_babylon/ir-graphs.js');
  openExample(id);
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
  return [...gaps].sort();
}

const id = process.argv[2];
if (id) console.log(JSON.stringify(await gapsOf(id)));
else {
  const examples = readdirSync(new URL('../examples/', import.meta.url)).filter((name) => existsSync(new URL(`../examples/${name}/${name}.blend`, import.meta.url)));
  const found = Object.fromEntries(examples.map((name) => [name, JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').at(-1))]));
  const listed = Object.fromEntries(Object.entries(found).filter(([name, gaps]) => gaps.length || GAPS[name]));
  assert.deepEqual(listed, Object.fromEntries(Object.entries(GAPS).filter(([name]) => found[name])), `relation gaps changed: ${JSON.stringify(listed)}`);
  console.log(`IR relations: ${Object.values(found).filter((gaps) => gaps.length).length} of ${examples.length} examples have relations a pointer walk misses: ${Object.entries(listed).filter(([, g]) => g.length).map(([n, g]) => `${n} (${g.join(', ')})`).join('; ')}`);
}
