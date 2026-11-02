// The Blender Coverage view's typed Add menu items: a modifier type counts when Bylonder defines it, a node type when
// its tree's editor runs it (src/coverage/variants.js), and the counts follow (coverage.js).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { computeCoverage, runtimeAvailable, variantItems } from '../src/coverage/coverage.js';
import { variantRuns } from '../src/coverage/variants.js';

new BlenderMain();
const surface = JSON.parse(await readFile('src/coverage/blender-surface.json', 'utf8'));
const variants = variantItems(surface).filter(([area, id]) => variantRuns(area, id)).map((item) => item.join(' '));
// Every menu drawn, so that only the items' own types decide.
const classes = surface.ids.filter((id) => /_(MT|PT)_/.test(id));
const result = computeCoverage(surface, [], '', runtimeAvailable({ classes, variants }));
const status = (area, id) => {
  const found = [];
  const visit = (node) => { if (node.id === id) found.push(node.status); node.c?.forEach(visit); };
  visit(result.tree.find((a) => a.id === area));
  return found[0];
};

const CASES = [
  ['PROPERTIES', 'object.modifier_add:ARRAY', 'done'],
  ['VIEW_3D', 'object.modifier_add:SUBSURF', 'done'],
  // Boolean needs another object: not offered yet (docs/blender-coverage.md, object.modifier_add).
  ['PROPERTIES', 'object.modifier_add:BOOLEAN', 'missing'],
  ['GeometryNodeTree', 'node.add_node:GeometryNodeMeshCube', 'done'],
  ['GeometryNodeTree', 'node.add_node:GeometryNodeInstanceOnPoints', 'done'],
  ['ShaderNodeTree', 'node.add_node:ShaderNodeMath', 'done'],
  ['CompositorNodeTree', 'node.add_node:CompositorNodeColorBalance', 'done'],
  ['CompositorNodeTree', 'node.add_node:CompositorNodeBlur', 'missing'],
];
for (const [area, id, expected] of CASES) assert.equal(status(area, id), expected, `${area} ${id}`);
assert.ok(!variantRuns('GeometryNodeTree', 'node.add_node:GeometryNodeNoSuchNode'), 'a node type the module does not register');
console.log(`Coverage variants: ${variants.length} of ${variantItems(surface).length} typed Add menu items run; ${CASES.length} known cases`);
