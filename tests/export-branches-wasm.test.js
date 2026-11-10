// File > Export's Branches (export-options.js) on the Compositor example. A Geometry Nodes stack is Live or Baked
// (modifiers-export.js geometryNodesEntities). By default one nothing in the page drives is baked, City Towers here (no input of a value, not
// reading the frame), and so is a Smooth by Angle nothing animates, which looks the same baked: the Compositor example's
// package then has no Geometry Nodes entity, no units of their trees in units.json and ships no Geometry Nodes kernels.
// Set Live, a stack runs in the page again. The compositor runs Live with its settings as controls, Baked with none, and
// Off is left out of the package.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { gplFiles } from '../src/io_scene_babylon/runtime-files.js';
import { sceneBranches } from '../src/io_scene_babylon/branches.js';

const { world, sync } = openExample('compositor');
sync.view();
const SMOOTH = 'NT:Smooth by Angle@geometry_nodes_essentials.blend.001';

async function exported(branches, branchState = null) {
  const files = await exportModule(world, { branches, branchState }), ir = JSON.parse(files['scene.ir.json']), units = JSON.parse(files['units.json']).units;
  return {
    runs: (key) => ir.entities[key]?.implementation === 'geometry-nodes',
    unitsOf: (graph) => Object.values(units).filter((u) => u.kind === 'geometry-node' && u.uses.some((use) => use.graph === graph)),
    compositor: files['scene.js'].includes('const COMPOSITOR ='),
    compositorControls: Object.values(ir.properties).filter((p) => p.bind?.compositor).length,
    kernels: gplFiles(files).some(([path]) => path === 'bylonder-geometry-nodes/geometry-nodes.wasm'),
  };
}

// The branches the export's tree lists, with their defaults.
const branches = sceneBranches(world);
assert.deepEqual(branches.compositor, { state: 'LIVE' });
assert.deepEqual(branches.geometryNodes.instances.filter(({ name }) => ['City', 'Upstairs Bar'].includes(name)), [{ name: 'City', state: 'BAKED' }, { name: 'Upstairs Bar', state: 'BAKED' }]);

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
assert.ok(baked.compositor && baked.compositorControls, "the compositor is Live by default, its settings controls");
const frozen = await exported({ compositor: { state: 'BAKED', instances: {} } });
assert.ok(frozen.compositor && !frozen.compositorControls, 'Baked, it runs with no controls');
const off = await exported({}, 'OFF');
assert.ok(!off.compositor, 'Off for every branch leaves it out');
assert.ok(!off.runs('OB:Upstairs Bar/modifier/Smooth by Angle'), 'and Geometry Nodes, which cannot be Off, keep their default');
console.log('Export: the compositor Live, Baked or Off, and Geometry Nodes stacks Live or Baked by the Branches option; undriven stacks and Smooth by Angle baked by default, with no kernels shipped');
process.exit(0);
