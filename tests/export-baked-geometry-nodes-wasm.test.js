// A Geometry Nodes stack is Live or Baked by File > Export's Branches (export-options.js, modifiers-export.js
// geometryNodesEntities). By default one nothing in the page drives is baked, City Towers here (no input of a value, not
// reading the frame), and so is a Smooth by Angle nothing animates, which looks the same baked: the Compositor example's
// package then has no Geometry Nodes entity, no units of their trees in units.json and ships no Geometry Nodes kernels.
// Set Live, a stack runs in the page again.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { gplFiles } from '../src/io_scene_babylon/runtime-files.js';

const { world, sync } = openExample('compositor');
sync.view();
const SMOOTH = 'NT:Smooth by Angle@geometry_nodes_essentials.blend.001';

async function exported(branches) {
  const files = await exportModule(world, { branches }), ir = JSON.parse(files['scene.ir.json']), units = JSON.parse(files['units.json']).units;
  return {
    runs: (key) => ir.entities[key]?.implementation === 'geometry-nodes',
    unitsOf: (graph) => Object.values(units).filter((u) => u.kind === 'geometry-node' && u.uses.some((use) => use.graph === graph)),
    kernels: gplFiles(files).some(([path]) => path === 'bylonder-geometry-nodes/geometry-nodes.wasm'),
  };
}

const baked = await exported({});
assert.ok(!baked.runs('OB:City/modifier/City Towers'), 'City Towers is baked: no entity runs it');
assert.ok(!baked.runs('OB:Upstairs Bar/modifier/Smooth by Angle'), 'Smooth by Angle is baked by default');
assert.deepEqual([...baked.unitsOf('NT:City Towers'), ...baked.unitsOf(SMOOTH)], [], 'units.json lists none of their nodes');
assert.ok(!baked.kernels, 'the package ships no Geometry Nodes kernels');

const live = await exported({ geometryNodes: { state: null, instances: { 'Upstairs Bar': 'LIVE' } } });
assert.ok(live.runs('OB:Upstairs Bar/modifier/Smooth by Angle'), 'Smooth by Angle set Live runs in the page');
assert.ok(!live.runs('OB:Upstairs Kissa/modifier/Smooth by Angle'), 'another instance keeps its default');
assert.ok(live.unitsOf(SMOOTH).length && live.kernels, "units.json lists Smooth by Angle's nodes and the kernels ship");

const all = await exported({ geometryNodes: { state: 'LIVE', instances: { 'Upstairs Kissa': 'BAKED' } } });
assert.ok(all.runs('OB:City/modifier/City Towers') && all.runs('OB:Upstairs Bar/modifier/Smooth by Angle'), 'Live for the branch runs every stack');
assert.ok(!all.runs('OB:Upstairs Kissa/modifier/Smooth by Angle'), 'but an instance set Baked stays baked');
console.log('Export: Geometry Nodes stacks Live or Baked by the Branches option; undriven stacks and Smooth by Angle baked by default, with no kernels shipped');
process.exit(0);
