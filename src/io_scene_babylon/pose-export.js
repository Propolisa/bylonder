// An armature's bone constraints as the page runs them (runtime/pose-constraints.js): on Blender's kernels
// (constraints.wasm, runtime/pose-kernels.js) where they cover the rig, else on the page's own solvers where it has one
// for each constraint; kept only where the page's pose is the one Main evaluated at every frame the export samples.
import { Matrix } from '@babylonjs/core';
import { posedBone } from './runtime/blend-scene.js';
import { blendData } from '../python/bpy_rna.js';
import { solvePose } from './runtime/pose-constraints.js';
import { kernelSolve } from './runtime/pose-kernels.js';
import { nativeSolve } from './runtime/native-solve.js';
import { packDescription, rigDescription } from './rig-description.js';
import { compileRig } from './runtime/native/rig/program.js';
import { compileDeform } from './runtime/native/deform/mesh.js';
import { shownStack } from '../runtimes/applied-rest.js';
import { loadConstraints } from './polyfill/constraints.js';
import { rigOf } from './rig-export.js';
import { bboneShape, key } from './controls-export.js';

// Blender's kernels, loaded once an export needs them (prepareKernels); none where they cannot load.
let kernels = null, loading = null;
export const prepareKernels = () => (loading ??= loadConstraints(new URL('../constraints/constraints.wasm', import.meta.url))
  .then((loaded) => { kernels = kernelSolve(loaded); }, () => {}));

const AXES = ['x', 'y', 'z'];
// The spaces the page converts between, for a bone and for an object target.
const BONE_SPACES = ['WORLD', 'POSE', 'LOCAL'];
// Matrices equal to the IK solver's own tolerance.
const TOLERANCE = 1e-3;
// Every how many checked frames the native runtime's deformed meshes are compared with Main's.
const DEFORM_CHECKS = 10;

// What a constraint reads, as the page finds it: a bone of the armature, or an object's node; undefined where it
// cannot; null where there is none.
const targetOf = (arm, ob, sub, nodeOf) => {
  if (!ob) return null;
  if (ob.name === arm.name && sub) return arm.pose.bones.get(sub) ? { bone: sub } : undefined;
  const node = !sub && nodeOf(ob);
  return node ? { node: node.id } : undefined;
};

// The IK chain of a pose bone's constraint, root first, when the page solves it: one or two bones.
function ikChain(pose, c) {
  const chain = [];
  for (let bone = pose; bone && (c.chain_count === 0 || chain.length < c.chain_count); bone = bone.parent) chain.unshift(bone);
  const plain = chain.every((b) => !b.ik_stretch && !b.lock_ik_x && !b.lock_ik_y && !b.lock_ik_z && !b.use_ik_limit_x && !b.use_ik_limit_y && !b.use_ik_limit_z);
  return chain.length <= 2 && plain ? chain.map((b) => b.name) : null;
}

// Each type's settings as the page reads them, or null where it does not solve it so.
const SETTINGS = {
  IK: (c, pose) => c.use_tail && !c.use_rotation && c.pole_target !== undefined && { chain: ikChain(pose, c), pole_angle: c.pole_angle },
  DAMPED_TRACK: (c) => ({ track_axis: c.track_axis, head_tail: c.head_tail }),
  TRACK_TO: (c) => ({ track_axis: c.track_axis, up_axis: c.up_axis, use_target_z: c.use_target_z, head_tail: c.head_tail }),
  COPY_ROTATION: (c) => (AXES.every((a) => c[`use_${a}`] && !c[`invert_${a}`]) && c.mix_mode === 'REPLACE' ? { head_tail: 0 } : null),
  LIMIT_ROTATION: (c) => (!c.use_legacy_behavior ? { euler_order: c.euler_order, limits: AXES.map((a) => (c[`use_limit_${a}`] ? [c[`min_${a}`], c[`max_${a}`]] : null)) } : null),
};

// An armature's bone constraints by bone, as the page runs them, or null where one is not run so.
export function poseStacks(arm, nodeOf) {
  if (arm.pose.ik_solver !== 'LEGACY') return null;
  const stacks = {};
  for (const pose of arm.pose.bones) {
    const list = [];
    for (const c of [...pose.constraints].filter((c) => !c.mute && c.enabled !== false)) {
      const settings = SETTINGS[c.type]?.(c, pose), target = targetOf(arm, c.target, c.subtarget, nodeOf);
      const spaces = BONE_SPACES.includes(c.owner_space) && (target?.node ? c.target_space === 'WORLD' : BONE_SPACES.includes(c.target_space));
      if (!settings || target === undefined || !spaces || (c.type === 'IK' && !settings.chain)) return null;
      const pole = c.type === 'IK' && targetOf(arm, c.pole_target, c.pole_subtarget, nodeOf);
      if (pole === undefined) return null;
      list.push({ name: c.name, type: c.type, influence: c.influence, owner_space: c.owner_space, target_space: c.target_space, ...settings, ...(target && { target }), ...(pole && { pole }) });
    }
    if (list.length) stacks[pose.name] = list;
  }
  return Object.keys(stacks).length ? stacks : null;
}

// A pose bone's own matrix (its location, rotation and scale after its rest), as blend-scene.js poses a Babylon Bone.
export const ownMatrix = (pose, bone) => posedBone({ mode: pose.rotation_mode }, (name) => [...pose[name]], bone.getRestMatrix());

// The constraints with their influences read from their controls (controls-export.js poseControls), so that a driver or
// the page sets them.
const influence = (arm, bone, c) => ({ property: `objects${key(arm.name)}.pose.bones${key(bone)}.constraints${key(c.name)}.influence` });
const influenced = (arm, stacks) => Object.fromEntries(Object.entries(stacks).map(([bone, list]) => [bone, list.map((c) => ({ ...c, influence: influence(arm, bone, c) }))]));
// A rig's B-Bones' own shapes for the kernels, by bone, by path: read from their controls (`property` paths), else from
// Main as it is now.
const shapes = (arm, read = (path) => ({ property: `objects${key(arm.name)}.pose.bones${path}` })) => Object.fromEntries([...arm.data.bones]
  .filter((b) => b.bbone_segments > 1).map((b) => [b.name, Object.fromEntries(bboneShape(arm.pose.bones.get(b.name)).map(([path, v]) => [path, read(`${key(b.name)}.${path}`, v)]))]));
// A rig's influences for the kernels, by bone, in its constraints' order.
const influences = (arm, rig) => Object.fromEntries(rig.bones.filter((b) => b.constraints.length).map((b) => [b.name, b.constraints.map((c) => influence(arm, b.name, c))]));

// The vertex each Babylon vertex of an evaluated mesh draws: its face corners', then its loose edges' two ends, as
// Blender's draw buffers lay them out (mesh-batch-cache.js).
const drawnVertices = (mesh) => Int32Array.from([...mesh.corner_verts, ...Array.from(mesh.loose_edges()).flatMap((e) => [mesh.edges[e * 2], mesh.edges[e * 2 + 1]])]);

// An armature's description for the native runtime (rig-description.js), packed: its JSON as bytes and its arrays; the
// page's animation poses the bones, so the armature plays no action of its own there, and the page places it and the
// objects its constraints and modifiers read (`objects`: their nodes' ids, by name), so they have no parents there.
// `deformed`: mesh objects Babylon cannot skin for their modifier stack ({ ob, node, mesh(), evaluated() }: Main's Mesh
// and the evaluated one the export draws; `source`: a mesh only another's Surface Deform reads, which goes in as data);
// those whose stack the runtime runs to the evaluated mesh's vertices go in
// with what draws each Babylon vertex (`draw_vertices`, drawnVertices), the page deforming them
// (`meshes`: their nodes' ids, by name). A hidden mesh, which Main does not evaluate, stays out.
function nativeRig(arm, nodeOf, deformed = []) {
  const shown = (ob) => new Set(shownStack(ob).map((m) => m.name)), keyed = deformed.filter((d) => d.keyed).map((d) => d.ob);
  const drawn = deformed.filter((d) => !d.source && !d.keyed), sources = deformed.filter((d) => d.source);
  const describe = (list) => {
    const all = [...list, ...sources.filter((s) => !list.includes(s))], description = rigDescription(arm, all.map((d) => d.ob), (ob) => all.find((d) => d.ob === ob).mesh(), keyed);
    for (const d of all) for (const m of description.objects.find((o) => o.name === d.ob.name).modifiers) m.show_viewport &&= shown(d.ob).has(m.name);
    return description;
  };
  let description = describe(drawn);
  const program = drawn.length && compileRig(structuredClone(description));
  const runs = drawn.filter((d) => {
    const deform = compileDeform(program, program.objectIndex.get(d.ob.name)), evaluated = d.evaluated();
    return !deform.unsupported.length && deform.geo.base.length === evaluated?.verts_num * 3 && d.node.getTotalVertices() === drawnVertices(evaluated).length;
  });
  if (runs.length < drawn.length) description = describe(runs);
  const objects = {}, meshes = {};
  for (const ob of description.objects) {
    Object.assign(ob, { parent: null, animation_data: null });
    const node = ob.name !== arm.name && nodeOf(blendData().objects.get(ob.name));
    if (node) objects[ob.name] = node.id;
  }
  for (const d of runs) {
    description.objects.find((o) => o.name === d.ob.name).data.draw_vertices = drawnVertices(d.evaluated());
    meshes[d.ob.name] = d.node.id;
  }
  const { packed, arrays } = packDescription(description);
  return { description: new TextEncoder().encode(JSON.stringify(packed)), arrays, armature: arm.name, objects, meshes, published: [...driven(arm, description), ...drivenKeys(keyed, description)] };
}
// The armature's and its pose bones' custom properties the rig's drivers set (a corrective's input the rig computes),
// which the runtime hands back to the page's controls after each solve so the page's drivers read them: each one's path
// (as setPath takes it), its bone (null for the armature's own), name and control.
const CUSTOM = /^(?:pose\.bones\["((?:[^"\\]|\\.)*)"\])?\["((?:[^"\\]|\\.)*)"\]$/;
const driven = (arm, description) => description.drivers.filter((d) => d.id === arm.name && d.id_type === 'OBJECT' && CUSTOM.test(d.data_path))
  .map((d) => { const [, bone = null, name] = CUSTOM.exec(d.data_path);
    return { path: d.data_path, bone: bone && JSON.parse(`"${bone}"`), name: JSON.parse(`"${name}"`), property: `objects${key(arm.name)}${d.data_path.startsWith('[') ? '' : '.'}${d.data_path}` }; })
  .filter((p, i, all) => all.findIndex((q) => q.path === p.path) === i);
// The shape keys the runtime's drivers set on the `keyed` meshes (correctives the page morphs by): each one's mesh, key,
// slider range (which Blender clamps a key's value to) and control, which the runtime's value is published to.
const KEY_VALUE = /^key_blocks\["((?:[^"\\]|\\.)*)"\]\.value$/;
const drivenKeys = (keyed, description) => keyed.flatMap((ob) => description.drivers.filter((d) => d.id_type === 'KEY' && d.id === ob.data.shape_keys.name && KEY_VALUE.test(d.data_path))
  .map((d) => { const name = JSON.parse(`"${KEY_VALUE.exec(d.data_path)[1]}"`), block = ob.data.shape_keys.key_blocks.get(name);
    return { mesh: ob.name, key: name, range: [block.slider_min, block.slider_max], property: `shape_keys${key(ob.data.shape_keys.name)}.key_blocks${key(name)}.value` }; }));
const nativeSolver = nativeSolve();
// The custom properties of an armature and its pose bones that its drivers read, and its constraints' keyed influences:
// their paths from the armature (as the runtime's setPath takes them), with Main's values now, or by `read(path)` (a
// control's reference).
const customProperties = (arm, read = (path, value) => value) => Object.fromEntries([...[['', arm], ...[...arm.pose.bones].map((pb) => [`pose.bones${key(pb.name)}`, pb])]
  .flatMap(([base, struct]) => [...(struct.keys?.() ?? [])].filter((name) => typeof struct.get(name) === 'number').map((name) => [`${base}${key(name)}`, read(`${base}${key(name)}`, struct.get(name))])),
  ...keyedInfluences(arm).map(({ path, constraint }) => [path, read(path, constraint.influence)])]);
// The influences of the armature's constraints that an action keys (its own or a clip's): the runtime takes them as the
// page animates them, its description holding only their values now.
const INFLUENCE = /^pose\.bones\["((?:[^"\\]|\\.)*)"\]\.constraints\["((?:[^"\\]|\\.)*)"\]\.influence$/;
const keyedInfluences = (arm) => [...new Set([...blendData().actions].flatMap((action) => [...action.layers].flatMap((layer) => [...layer.strips])
  .flatMap((strip) => [...strip.channelbags]).flatMap((bag) => [...bag.fcurves].map((fc) => fc.data_path))))]
  .flatMap((path) => { const [, bone, name] = INFLUENCE.exec(path) ?? [], constraint = bone && arm.pose.bones.get(JSON.parse(`"${bone}"`))?.constraints.get(JSON.parse(`"${name}"`));
    return constraint ? [{ path, constraint }] : []; });

const close = (a, b) => a.asArray().every((v, i) => Math.abs(v - b.asArray()[i]) <= TOLERANCE);

// For an armature drawn by one skeleton, its bone constraints as the page runs them (on the kernels when an export has
// prepared them and they cover the rig, its skeleton holding every bone): `check(evaluated)` compares the
// page's pose with Main's at the frame Main is on (`frame`; `evaluated`: each bone's local matrix as the skeleton holds it),
// recording each bone's own matrix; `entity()` the IR entity's inputs once every check held, else null, the bones'
// own matrices those of the frame Main is on then; `moved`, the bones the constraints move, and `own(bone)` a bone's
// own matrices at the frames checked. `meshWorld()` gives the skinned mesh's
// world matrix and `nodeWorld(id)` a node's, at the frame Main is on. On the native runtime, the `deformed` meshes it
// runs (nativeRig) are `deforms`, their names, and each check compares some frames' deform with Main's evaluated mesh:
// `deviation`, the largest distance of a vertex from Main's by mesh name.
export function livePoseConstraints(arm, skeleton, mesh, { nodeOf, meshWorld, nodeWorld, deformed = [] }) {
  // The armature's own bones, without its B-Bones' segment joints after them.
  const bones = skeleton.bones.slice(0, skeleton.armatureBones);
  const targetOf = (ob, bone) => { const node = !bone && nodeOf(ob); return node ? { node: node.id } : undefined; };
  const rig = kernels && bones.length === arm.data.bones.length && rigOf(arm, [...arm.data.bones].map((b) => b.name), targetOf);
  const native = !rig && bones.length === arm.data.bones.length ? nativeRig(arm, nodeOf, deformed) : null;
  const deforms = Object.keys(native?.meshes ?? {}), deviation = new Map(deforms.map((name) => [name, 0]));
  const evaluatedOf = new Map(deformed.map((d) => [d.ob.name, d.evaluated]));
  const stacks = rig || native ? {} : poseStacks(arm, nodeOf);
  if (!rig && !native && !stacks) return null;
  const solve = rig ? kernels : native ? nativeSolver : solvePose, poses = bones.map((bone) => arm.pose.bones.get(bone.name));
  if (poses.some((pose) => !pose || pose.rotation_mode === 'AXIS_ANGLE')) return null;
  const shape = bones.map((bone, i) => ({ name: bone.name, parent: bone.getParent() ? bones.indexOf(bone.getParent()) : -1, rest: bone.getRestMatrix(),
    length: arm.data.bones.get(bone.name).length, mode: poses[i].rotation_mode }));
  const moved = new Set(), owns = new Map(bones.map((bone) => [bone, []]));
  // The bones whose pose must be Main's: every one on the kernels and the page's solvers; on the native runtime, those
  // that deform and their parents, as a mechanism bone off by a little moves nothing the page draws.
  const deforming = (i) => arm.data.bones.get(bones[i].name).use_deform, judged = new Set(bones.map((_, i) => i).filter((i) => !native || deforming(i)));
  for (const i of [...judged]) for (let p = shape[i].parent; p >= 0; p = shape[p].parent) judged.add(p);
  // The B-Bones whose segments the kernels shape as Main does at every frame checked.
  const shaped = new Set(rig ? [...arm.data.bones].filter((b) => b.bbone_segments > 1).map((b) => b.name) : []);
  let checked = 0, held = true;
  const solved = new Map();
  // The pose the page draws, by the runtime's pass over the skeleton's bones as the page holds them, each given its own
  // pose each frame as the page's animation gives it.
  const page = native && { skeleton: { bones: skeleton.bones.map((bone) => ({ name: bone.name, _localMatrix: new Matrix(), get _matrix() { return this._localMatrix; }, markAsDirty() {} })) },
    shape: skeleton.bones.map((bone) => ({ parent: skeleton.bones.indexOf(bone.getParent()), rest: bone.getRestMatrix() })), native, space: skeleton.space,
    mesh: { computeWorldMatrix: meshWorld }, scene: { getNodeById: (id) => ({ computeWorldMatrix: () => nodeWorld(id) }) } };
  const posedByPage = (locals, frame) => {
    page.skeleton.bones.forEach((bone, i) => { if (i < locals.length) bone._localMatrix.copyFrom(locals[i]); });
    nativeSolver.pass(Object.assign(page, { properties: customProperties(arm), frame }));
    return page.skeleton.bones.slice(0, locals.length).map((bone) => bone._matrix);
  };
  return {
    moved,
    native: !!native,
    deforms,
    deviation,
    own: (bone) => owns.get(bone),
    check(evaluated, frame) {
      const locals = bones.map((bone, i) => ownMatrix(poses[i], bone));
      bones.forEach((bone, i) => owns.get(bone).push(locals[i]));
      const current = rig && Object.fromEntries(rig.bones.filter((b) => b.constraints.length).map((b) => [b.name, [...arm.pose.bones.get(b.name).constraints].map((c) => c.influence)]));
      const result = solve({ bones: shape, locals, mesh: meshWorld(), space: skeleton.space, stacks, kernels: rig, influences: current,
        shapes: rig && shapes(arm, (path, v) => v), nodeWorld, native, properties: native && customProperties(arm), frame });
      // Every bone the solver has moved is judged at every frame: a solver gives only what changed since its last solve.
      for (const [i, local] of result) {
        moved.add(bones[i]);
        solved.set(i, local);
      }
      for (const [i, local] of solved) held &&= !judged.has(i) || close(local, evaluated[i]);
      if (native) held &&= posedByPage(locals, frame).every((m, i) => !judged.has(i) || close(m, evaluated[i]));
      for (const name of shaped) {
        const pose = arm.pose.bones.get(name), ours = solve.segments(rig, name);
        if (!ours.every((m, k) => Array.from(pose.bbone_segment_matrix(k, false)).every((v, j) => Math.abs(v - m[j]) <= TOLERANCE))) shaped.delete(name);
      }
      if (checked % DEFORM_CHECKS === 0) for (const name of deforms) {
        const ours = nativeSolver.deformed(native, name), theirs = evaluatedOf.get(name)().vert_positions;
        let worst = deviation.get(name);
        for (let v = 0; v < theirs.length; v += 3) worst = Math.max(worst, Math.hypot(ours[v] - theirs[v], ours[v + 1] - theirs[v + 1], ours[v + 2] - theirs[v + 2]));
        deviation.set(name, worst);
      }
      checked++;
    },
    entity: () => (checked && held ? {
      skeleton: skeleton.id, mesh: mesh.id, space: skeleton.space.asArray(), constraints: influenced(arm, stacks),
      ...(rig && { kernels: rig, influences: influences(arm, rig), shapes: shapes(arm), segments: [...shaped] }),
      ...(native && { native, properties: customProperties(arm, (path) => ({ property: `objects${key(arm.name)}${path.startsWith('[') ? '' : '.'}${path}` })) }),
      bones: Object.fromEntries(shape.map(({ name, length, mode }, i) => [name, { length, mode, ...(moved.has(bones[i]) && { own: ownMatrix(poses[i], bones[i]).asArray() }) }])),
    } : null),
  };
}
