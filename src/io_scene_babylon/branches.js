// The branches of a scene File > Export > JavaScript offers (export-options.js BRANCHES): each self-contained part of
// it a package can run in its page, freeze to its evaluated result, or leave out, with what each defaults to.
import { idStruct } from '../python/bpy_rna.js';
import { geometryNodesDefault, geometryNodesStack } from './modifiers-export.js';
import { treeReadsFrame } from './ir-export.js';

// [id, label, icon] of each branch, in the order the export's tree lists them.
export const BRANCH_ROWS = [['geometryNodes', 'Geometry Nodes', 'GEOMETRY_NODES'], ['compositor', 'Compositor', 'NODE_COMPOSITING']];

// The scene's Geometry Nodes stacks, by object: { name, state } with the state each exports with by default.
function geometryNodesInstances(world) {
  return world.objects.map((node) => geometryNodesStack(world.mainSync.objectOf(node))).filter(Boolean)
    .map(({ ob, shown }) => ({ name: ob.name, state: geometryNodesDefault(ob, shown, treeReadsFrame) }));
}

// Whether the scene composites in the page: a camera to look through and a compositor in use (compositor-export.js).
function composites(world) {
  const sync = world.mainSync;
  return !!(world.scene.cameras.length && sync?.compositingTree() && idStruct(sync.blender.scene).render.use_compositing);
}

// The branches the scene has, by id: { state, instances } with their default states; a branch without instances has
// one state for the scene.
export function sceneBranches(world) {
  if (!world.mainSync) return {};
  const gn = geometryNodesInstances(world);
  return {
    ...(gn.length && { geometryNodes: { instances: gn } }),
    ...(composites(world) && { compositor: { state: 'LIVE' } }),
  };
}
