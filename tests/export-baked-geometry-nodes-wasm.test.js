// A Geometry Nodes stack nothing in an exported page drives stays baked (modifiers-export.js geometryNodesEntities): the
// Compositor example's City Towers has no input of a value and does not read the frame, so the package draws its
// evaluated mesh, with no entity, no units of its tree in units.json and no Geometry Nodes kernels for it; the Smooth
// by Angle modifiers, whose angle is a control, still run live.
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, sync } = openExample('compositor');
sync.view();
const files = await exportModule(world), ir = JSON.parse(files['scene.ir.json']), units = JSON.parse(files['units.json']).units;
const runs = (key) => ir.entities[key]?.implementation === 'geometry-nodes';
assert.ok(!('OB:City/modifier/City Towers' in ir.entities), 'City Towers is baked: no entity runs it');
assert.ok(runs('OB:Upstairs Bar/modifier/Smooth by Angle'), 'Smooth by Angle, which a control drives, runs live');
const geometryUnitsIn = (graph) => Object.values(units).filter((u) => u.kind === 'geometry-node' && u.uses.some((use) => use.graph === graph));
assert.deepEqual(geometryUnitsIn('NT:City Towers'), [], "units.json lists none of City Towers' nodes");
assert.ok(geometryUnitsIn('NT:Smooth by Angle@geometry_nodes_essentials.blend.001').length, "but lists Smooth by Angle's");
console.log('Export: a Geometry Nodes stack nothing drives stays baked, its nodes out of units.json; a driven one runs live');
process.exit(0);
