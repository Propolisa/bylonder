// Node trees as the IR's graphs on the Hair Dynamics example: Blender's hair node groups (bundles, closures, zones,
// structs pointing back at their owners) write as plain JSON, each pointer cycle cut.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { blendData } from '../src/python/bpy_rna.js';
import { writeGraph, idKey } from '../src/io_scene_babylon/ir-graphs.js';

openExample('hair-dynamics');
const graphs = {};
for (const tree of blendData().node_groups) writeGraph(tree, idKey(tree), graphs);
for (const name of ['Rename Sim Attributes', 'Set Geo Updater - Deform Only']) assert.ok(graphs[`NT:${name}`]?.nodes.length, `${name} is written`);
const text = JSON.stringify(graphs);
assert.deepEqual(JSON.parse(text), graphs, 'graphs are plain JSON');
const closure = Object.values(graphs).flatMap((g) => g.nodes).find((n) => n.type === 'node:NodeClosureInput');
assert.deepEqual(closure.settings.paired_output, { node: 'Closure Output' }, 'a zone\'s paired node by its name');
console.log(`IR graphs: Hair Dynamics' ${Object.keys(graphs).length} node groups write as plain data`);
