// The branches of a scene File > Export > JavaScript offers (export-options.js BRANCHES): each self-contained part of
// it a package can run in its page, freeze to its evaluated result, or leave out, with what each defaults to.
import { idStruct } from '../python/bpy_rna.js';
import { geometryNodesDefault, geometryNodesStack, liveStack } from './modifiers-export.js';
import { treeReadsFrame } from './ir-export.js';
import { cameraEffects } from './babylon-export.js';
import { displayOnly } from './js-export.js';
import { hasVolumes } from './volumes-export.js';

// [id, label, icon] of each branch, in the order the export's tree lists them.
export const BRANCH_ROWS = [['modifiers', 'Modifiers', 'MODIFIER'], ['geometryNodes', 'Geometry Nodes', 'GEOMETRY_NODES'], ['curves', 'Curves', 'CURVES_DATA'],
  ['volumes', 'Volumes', 'VOLUME_DATA'], ['postProcessing', 'Post-processing', 'SHADING_RENDERED'], ['compositor', 'Compositor', 'NODE_COMPOSITING']];

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

// Whether a render draws curves the page would draw (curves-export.js).
const drawsCurves = (world) => world.mainSync.blender.curves().some((r) => r.render && r.indirection.length);

// Whether the scene's camera has effects the package carries: rendering pipelines or post-processes (babylon-export.js).
function postProcessed(world) {
  const camera = world.scene.activeCamera;
  if (!camera) return false;
  const { renderingPipelines, postProcesses } = cameraEffects(world, world.scene, camera);
  return postProcesses.length > 0 || renderingPipelines.some((p) => !displayOnly(p));
}

// The branches the scene has, by id: { state, instances } with their default states; a branch without instances has
// one state for the scene. `live`: whether modifier stacks are Live by default (File > Export > JavaScript, Live
// Modifiers).
export function sceneBranches(world, { live = false } = {}) {
  if (!world.mainSync) return {};
  const stacks = world.objects.filter((node) => liveStack(world, node)).map((node) => ({ name: node.name, state: live ? 'LIVE' : 'BAKED' }));
  const gn = geometryNodesInstances(world);
  return {
    ...(stacks.length && { modifiers: { instances: stacks } }),
    ...(gn.length && { geometryNodes: { instances: gn } }),
    ...(drawsCurves(world) && { curves: { state: 'LIVE' } }),
    ...(hasVolumes(world.scene) && { volumes: { state: 'LIVE' } }),
    ...(postProcessed(world) && { postProcessing: { state: 'LIVE' } }),
    ...(composites(world) && { compositor: { state: 'LIVE' } }),
  };
}
