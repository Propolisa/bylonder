// An armature's rig as Blender's constraint kernels (constraints.wasm, polyfill/constraints.js) take it: each bone's,
// pose bone's and constraint's settings by RNA name, read from the DNA fields Main holds (dna-constraints.json), with
// the layouts the kernels write them at, and each constraint's targets as the page finds them.
import { readValues } from '../modifiers/dna-write.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import dna from '../makesrna/dna-constraints.json' with { type: 'json' };
import { MATRIX_ONLY } from './polyfill/constraints.js';
import { layoutsOf } from './rig-layouts.js';

export { layoutsOf };

const view = () => new DataView(blenderModule.exports.memory.buffer);
const decoder = new TextDecoder();
const text = (address, length) => {
  const bytes = new Uint8Array(blenderModule.exports.memory.buffer, address >>> 0, length);
  return decoder.decode(bytes.subarray(0, Math.max(0, bytes.indexOf(0))));
};

/** A struct's settings in Main's memory by RNA name, an array's as an array. @param {number} address @param {Record<string, any>} layouts */
export function settings(address, layouts) {
  return Object.fromEntries(Object.entries(layouts).map(([name, layout]) => {
    if (layout.kind === 'int' && layout.size === 1 && layout.length) return [name, text(address + layout.offset, layout.length)];
    const length = layout.length ?? layout.bitset;
    if (!length) return [name, readValues(view(), address, layouts, [name])[name]];
    const values = readValues(view(), address, layouts, Array.from({ length }, (_, i) => `${name}[${i}]`));
    return [name, Object.values(values)];
  }));
}

// A constraint's targets in Blender's order (IK's target, then its pole), each the object and bone it names.
const targetsOf = (c, struct) => [['target', 'subtarget'], ['pole_target', 'pole_subtarget']].filter(([name]) => dna[struct].properties[name])
  .map(([name, bone]) => [c[name], c[bone]]);

/**
 * A stack's constraints as the kernels take them, or null where one is not theirs to run (a type that reads more than
 * matrices, a target the page cannot place).
 * @param {any} owner the armature object of a bone's stack, else null
 * @param {any[]} constraints RNA constraints
 * @param {(ob: any, bone: string) => any} targetOf a target as the page finds it, or undefined
 */
export function stackOf(owner, constraints, targetOf) {
  const out = [];
  for (const c of constraints) {
    if (!MATRIX_ONLY.has(c.type)) return null;
    const struct = c.bl_rna.identifier, address = c.as_pointer();
    const data = view().getUint32(address + dna[struct].from, true);
    const resolve = ([ob, bone]) => (!ob ? null : ob === owner && bone ? { bone } : targetOf(ob, bone || ''));
    const targets = targetsOf(c, struct).map(resolve);
    if (targets.includes(undefined)) return null;
    const armature = c.type === 'ARMATURE' ? [...c.targets].map((t) => ({ target: resolve([t.target, t.subtarget]), weight: t.weight })) : [];
    if (armature.some((t) => t.target === undefined || t.target === null)) return null;
    out.push({ type: c.type, name: c.name, struct, constraint: settings(address, layoutsOf('Constraint')), settings: settings(data, layoutsOf(struct)),
      targets, ...(armature.length && { armature_targets: armature }) });
  }
  return out;
}

/** The layouts of the structs a rig's stacks use, for the kernels to write them at. @param {any[][]} stacks */
export const rigLayouts = (stacks) => Object.fromEntries(['Constraint', 'ConstraintTarget', 'ConstraintTargetBone', 'Bone', 'PoseBone', 'Pose', 'Armature',
  ...new Set(stacks.flat().map((c) => c.struct))].map((struct) => [struct, layoutsOf(struct)]));

/**
 * An armature object's rig, its bones in `order` (names, parents before children), or null where a bone's constraints
 * are not the kernels' to run.
 * @param {any} ob an armature object (RNA)
 * @param {string[]} order
 * @param {(ob: any, bone: string) => any} targetOf
 */
export function rigOf(ob, order, targetOf) {
  const index = new Map(order.map((name, i) => [name, i]));
  const bones = [];
  for (const name of order) {
    const pb = ob.pose.bones.get(name), bone = ob.data.bones.get(name);
    const constraints = stackOf(ob, [...pb.constraints], targetOf);
    if (!constraints) return null;
    const parent = bone.parent ? index.get(bone.parent.name) ?? -1 : -1;
    if (parent >= bones.length) return null;
    const handles = [bone.bbone_custom_handle_start, bone.bbone_custom_handle_end].map((h) => (h ? index.get(h.name) ?? -1 : -1));
    bones.push({ name, parent, bone: settings(bone.as_pointer(), layoutsOf('Bone')), pose: settings(pb.as_pointer(), layoutsOf('PoseBone')), constraints,
      ...(handles.some((h) => h >= 0) && { handles }) });
  }
  return { bones, armature: settings(ob.data.as_pointer(), layoutsOf('Armature')), pose: settings(ob.pose.as_pointer(), layoutsOf('Pose')),
    layouts: rigLayouts(bones.map((b) => b.constraints)) };
}
