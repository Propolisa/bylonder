// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `native-rig` solver of `constraints:POSE` entities: an armature's pose after its constraints and drivers by the
// clean room's rig runtime (native/, babylon-blender-rig), from the armature's `bylonder-rig` description
// (rig-description.js), run by pose-constraints.js in place of its own solvers: the same inputs and result as
// pose-kernels.js, each bone's Babylon local matrix by the skeleton's index. The meshes Babylon cannot skin for their
// modifier stack (the description's `meshes`) it deforms after the pose: on WebGPU in compute, else on the CPU.
import { Matrix, Quaternion, Vector3, VertexBuffer } from '@babylonjs/core';
import { compileRig } from './native/rig/program.js';
import { compileDeform, deformMesh } from './native/deform/mesh.js';
import { bboneContext, bboneJoints } from './native/deform/bbone.js';
import { invertAffine, mulAffine } from './native/rig/m4.js';
import { CpuDeformer, GpuDeformer, gpuSupported } from './native/babylon/gpu-deform.js';
import { swapped } from './constraints-evaluator.js';
import { unpackDescription } from './native-rig.js';
import { load as loadPose } from './pose-constraints.js';

/**
 * @typedef {{ bones: { name: string, parent: number, rest: Matrix }[], locals: Matrix[], mesh: Matrix, space: Matrix,
 *   native: { description: Uint8Array, arrays: ArrayLike<number>[], armature: string, objects?: Record<string, string>, meshes?: Record<string, string> }, properties?: Record<string, number>,
 *   frame?: number, nodeWorld?: (id: string) => Matrix | null }} NativePose
 */

/** The runtime's rig of a description (its JSON in scene.bin, the arrays it names), compiled once. @param {NativePose['native']} native */
function compile(native) {
  const text = JSON.parse(new TextDecoder().decode(native.description));
  /** @type {(v: any) => any} */
  const resolve = (v) => (v?.constructor === Object && 'array' in v ? native.arrays[v.array]
    : Array.isArray(v) ? v.map(resolve) : v?.constructor === Object ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)])) : v);
  const program = compileRig(unpackDescription(resolve(text))), rig = program.instance();
  /** @type {WeakMap<object, { of: number[], unrest: Matrix[], last: Matrix[] }>} */
  const layouts = new WeakMap();
  return { program, rig, armature: program.objectIndex.get(native.armature), layouts, properties: new Map(), placed: new Map(), posed: /** @type {Float64Array | null} */ (null),
    deforms: /** @type {Map<string, any>} Each deformed mesh's stack, by name. */ (new Map()), deformers: /** @type {{ update(): void }[] | null} */ (null) };
}

/** A mesh's deform stack on an entry's rig, compiled once. @param {ReturnType<typeof compile>} entry @param {string} name */
const deformOf = (entry, name) => entry.deforms.get(name) ?? entry.deforms.set(name, compileDeform(entry.program, entry.program.objectIndex.get(name), /** @type {any} */ (entry.rig))).get(name);

// A page's meshes hold Blender's object space with Y and Z swapped (mesh-batch-cache.js).
const AXIS = /** @type {any} */ (Matrix.FromArray([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]));

/**
 * A page mesh deformed by the rig each frame: through compute on WebGPU once its kernels are ready, else on the CPU
 * into its vertex buffers, its bounds following.
 * @param {import('@babylonjs/core').Scene} scene @param {ReturnType<typeof compile>} entry @param {string} name @param {any} mesh
 */
function deformer(scene, entry, name, mesh) {
  const deform = deformOf(entry, name), engine = scene.getEngine();
  if (engine.isWebGPU && gpuSupported(deform).supported) {
    const gpu = new GpuDeformer(engine, entry.rig, deform, mesh, { axis: AXIS });
    let ready = false;
    gpu.whenReady().then(() => { ready = true; });
    mesh.alwaysSelectAsActiveMesh = true;
    return { update: () => ready && gpu.update() };
  }
  mesh.makeGeometryUnique();
  for (const kind of [VertexBuffer.PositionKind, VertexBuffer.NormalKind]) { const data = mesh.getVerticesData(kind); if (data) mesh.setVerticesData(kind, Float32Array.from(data), true); }
  const cpu = new CpuDeformer(entry.rig, deform, mesh, { axis: AXIS }), min = new Vector3(), max = new Vector3();
  return {
    update() {
      const positions = cpu.update();
      min.setAll(Infinity);
      max.setAll(-Infinity);
      for (let i = 0; i < positions.length; i += 3) {
        min.minimizeInPlaceFromFloats(positions[i], positions[i + 1], positions[i + 2]);
        max.maximizeInPlaceFromFloats(positions[i], positions[i + 1], positions[i + 2]);
      }
      mesh.getBoundingInfo().reConstruct(min, max, mesh.getWorldMatrix());
    },
  };
}

/** Places an object of the rig at a world matrix (Babylon's), where it moved. @param {ReturnType<typeof compile>} entry @param {number | undefined} index @param {Matrix} world */
function place(entry, index, world) {
  if (index === undefined) return;
  const m = swapped(world), key = Array.from(m.m).join();
  if (entry.placed.get(index) === key) return;
  entry.placed.set(index, key);
  entry.rig.setObjectBasis(index, Float64Array.from(m.m));
}

/** Whether 16 numbers equal a stored matrix's. @param {ArrayLike<number>} m @param {Float64Array} store @param {number} i */
const same = (m, store, i) => { for (let k = 0; k < 16; k++) if (m[k] !== store[i * 16 + k]) return false; return true; };
// Blender's axes and Babylon's differ by swapping Y and Z: a matrix's rows and columns 1 and 2.
const AXIS_ORDER = [0, 2, 1, 3], SWAPPED = new Array(16);
/** 16 numbers (a matrix's, from `at`) in the other axes, into `out`. @param {ArrayLike<number>} a @param {Matrix} out @param {number} [at] */
const swapAxes = (a, out, at = 0) => {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) SWAPPED[r * 4 + c] = a[at + AXIS_ORDER[r] * 4 + AXIS_ORDER[c]];
  Matrix.FromArrayToRef(SWAPPED, 0, out);
};
/** A bone's local matrix written as is (no decomposing), and kept as the one last written. @param {any} bone @param {Matrix} m @param {Float64Array} written @param {number} i */
const writeLocal = (bone, m, written, i) => {
  bone._localMatrix.copyFrom(m);
  bone.markAsDirty();
  written.set(m.m, i * 16);
};
/**
 * A skeleton's layout in the rig for the page's direct pass: each bone's rig index (`of`, -1 for a B-Bone joint), each
 * rig bone's skeleton index, each bone's children and inverted rest, its B-Bones' segment joints, the local matrices last
 * written, the own ones last given and those onSolved's observers wrote, and scratch matrices.
 * @param {ReturnType<typeof compile>} entry @param {any[]} bones @param {{ parent: number, rest: Matrix }[]} shape
 */
function directState(entry, bones, shape) {
  const index = entry.program.objects[entry.armature].boneIndex, of = bones.map((b) => /** @type {number} */ (index.get(b.name) ?? -1));
  const skeletonOf = new Int32Array(entry.program.bones?.length ?? 0).fill(-1), changed = new Uint8Array(skeletonOf.length), children = bones.map(() => /** @type {number[]} */ ([]));
  of.forEach((b, i) => { if (b >= 0) skeletonOf[b] = i; if (shape[i].parent >= 0 && b >= 0) children[shape[i].parent].push(i); });
  // A B-Bone's segment joints (`name#k`, after the armature's bones), by the rig's index of their bone.
  const program = /** @type {any} */ (entry.program), rigBones = /** @type {any[]} */ (program.bones);
  // The bones a B-Bone's shape follows: itself, its parent and connected child, and its custom handles.
  const handles = (/** @type {number} */ b) => [b, program.parent[b], ...rigBones.filter((c) => program.parent[c.index] === b && c.use_connect).map((c) => c.index),
    ...['start', 'end'].map((end) => index.get(rigBones[b][`bbone_custom_handle_${end}`] ?? '') ?? -1)].filter((h) => h >= 0);
  const joints = bones.flatMap((bone, i) => { const at = bone.name.lastIndexOf('#'), b = at > 0 ? index.get(bone.name.slice(0, at)) : undefined;
    return b === undefined ? [] : [{ i, b, k: Number(bone.name.slice(at + 1)), handles: handles(b) }]; });
  const stored = () => new Float64Array(bones.length * 16).fill(NaN);
  return { of, skeletonOf, children, joints, changed, unrest: shape.map((b) => Matrix.Invert(b.rest)), written: stored(), own: stored(), write: new Uint8Array(bones.length),
    given: /** @type {number[]} */ ([]), local: new Matrix(), swap: new Matrix(), inverse: new Float64Array(16), relative: new Float64Array(16), layered: stored() };
}

/**
 * The solver: `solve(pose)` gives each bone's Babylon local matrix after the rig's constraints and drivers, and deforms
 * the description's meshes in `scene`; `solve.deformed(native, name)`, a mesh's positions as the last solve deforms them
 * (Blender's object space, each evaluated vertex's xyz); `solve.pass(entry)`, the page's pass over a skeleton.
 * @param {import('@babylonjs/core').Scene | null} [scene]
 * @returns {((pose: NativePose) => Map<number, Matrix>) & { pass(entry: any): void, deformed(native: NativePose['native'], name: string): Float64Array }}
 */
export function nativeSolve(scene = null) {
  /** Each rig by the description it was compiled from. @type {WeakMap<Uint8Array, ReturnType<typeof compile>>} */
  const rigs = new WeakMap();
  const scale = new Vector3(), turn = new Quaternion(), at = new Vector3();
  /** The entry of a description, compiled at the first ask. @param {NativePose['native']} native */
  const entryOf = (native) => /** @type {ReturnType<typeof compile>} */ (rigs.get(native.description) ?? rigs.set(native.description, compile(native)).get(native.description));
  /**
   * Runs the rig after its inputs: the custom properties drivers read (`["name"]` of the armature, `pose.bones["B"]["name"]`
   * of a bone) where set, the armature and the objects its constraints and modifiers read where the page places them
   * (Blender's axes), the frame.
   * @param {ReturnType<typeof compile>} entry @param {Omit<NativePose, 'bones' | 'locals'>} pose
   */
  const run = (entry, { mesh, space, native, properties = {}, frame = 0, nodeWorld = () => null }) => {
    const { program, rig } = entry;
    for (const [path, value] of Object.entries(properties)) {
      if (entry.properties.get(path) === value) continue;
      entry.properties.set(path, value);
      rig.setPath(native.armature, path, value);
    }
    place(entry, entry.armature, space.multiply(mesh));
    for (const [name, id] of Object.entries(native.objects ?? {})) { const world = nodeWorld(id); if (world) place(entry, program.objectIndex.get(name), world); }
    rig.setFrame(frame);
    rig.evaluate();
  };
  /** Deforms the rig's meshes in the scene by its pose. @param {ReturnType<typeof compile>} entry @param {NativePose['native']} native */
  const deform = (entry, native) => {
    if (!scene) return;
    entry.deformers ??= Object.entries(native.meshes ?? {}).flatMap(([name, id]) => { const node = scene.getMeshById(id); return node ? [deformer(scene, entry, name, node)] : []; });
    for (const d of entry.deformers) d.update();
  };
  /** A bone's own location, rotation and scale from its Babylon local matrix (Blender's axes). @param {any} rig @param {number} b @param {Matrix} local @param {Matrix} unrest */
  const give = (rig, b, local, unrest) => {
    swapped(local.multiply(unrest)).decompose(scale, turn, at);
    rig.setBonePose(b, { location: at.asArray(), rotation_mode: 'QUATERNION', rotation_quaternion: [turn.w, turn.x, turn.y, turn.z], scale: scale.asArray() });
  };
  /** @param {NativePose} pose */
  const solve = (pose) => {
    const { bones, locals, space } = pose, entry = entryOf(pose.native), { program, rig } = entry;
    // The skeleton's bones in the rig, and their inverted rests, found once per skeleton.
    if (!entry.layouts.has(bones)) {
      const index = program.objects[entry.armature].boneIndex;
      entry.layouts.set(bones, { of: bones.map((b) => /** @type {number} */ (index.get(b.name) ?? -1)), unrest: bones.map((b) => Matrix.Invert(b.rest)), last: [] });
    }
    const { of, unrest, last } = /** @type {{ of: number[], unrest: Matrix[], last: Matrix[] }} */ (entry.layouts.get(bones));
    // Each bone's own location, rotation and scale, as the page or its animation set them, where they changed: the
    // runtime then reruns only what depends on them.
    const given = new Set();
    of.forEach((b, i) => {
      if (b < 0 || last[i]?.equals(locals[i])) return;
      given.add(i);
      last[i] = locals[i].clone();
      give(rig, b, locals[i], unrest[i]);
    });
    run(entry, pose);
    deform(entry, pose.native);
    // The bones whose pose or parent's pose changed since the last solve, or that were given a new own matrix (an
    // animation sets it each frame): the others keep the matrices they hold.
    /** @type {Map<number, Matrix>} */
    const result = new Map(), posed = rig.pose, before = entry.posed ?? new Float64Array(posed.length).fill(NaN);
    const moved = (/** @type {number} */ b) => { for (let k = b * 16; k < b * 16 + 16; k++) if (posed[k] !== before[k]) return true; return false; };
    of.forEach((b, i) => {
      if (b < 0 || !(given.has(i) || moved(b) || (bones[i].parent >= 0 && of[bones[i].parent] >= 0 && moved(of[bones[i].parent])))) return;
      const own = Matrix.FromArray(posed, b * 16), parent = bones[i].parent >= 0 ? of[bones[i].parent] : -1;
      result.set(i, parent < 0 ? swapped(own).multiply(space) : swapped(own.multiply(Matrix.Invert(Matrix.FromArray(posed, parent * 16)))));
    });
    entry.posed = Float64Array.from(posed);
    return result;
  };
  /**
   * The page's pass over a skeleton the runtime poses (pose-constraints.js apply): a bone whose local matrix is not the
   * one last written was given its own pose (by an animation or the page) and goes to the runtime; after it runs, the
   * bones it reports changed, their children and those given are written straight into the skeleton's local matrices, and
 * its B-Bones' segment joints from the runtime's shapes; then `skeleton.bylonderRig.onSolved` observers may layer on the
 * solved pose for that frame, before the runtime deforms its meshes.
   * @param {any} attached pose-constraints.js's entry
   */
  const pass = (attached) => {
    const bones = attached.skeleton.bones, entry = entryOf(attached.native), { rig } = entry;
    const state = attached.direct ??= directState(entry, bones, attached.shape);
    const { of, skeletonOf, children, unrest, written, own, given, write, layered } = state;
    given.length = 0;
    for (let i = 0; i < bones.length; i++) {
      const b = of[i];
      if (b < 0) continue;
      const m = bones[i]._matrix.m;
      if (same(m, written, i)) continue;
      // What a layer wrote last frame (onSolved): not the bone's own pose, and written over with the solved one.
      if (same(m, layered, i)) { written[i * 16] = NaN; given.push(i); continue; }
      given.push(i);
      if (same(m, own, i)) continue;
      own.set(m, i * 16);
      give(rig, b, bones[i]._matrix, unrest[i]);
    }
    run(entry, { mesh: attached.mesh.computeWorldMatrix(true), space: attached.space, native: attached.native, properties: attached.properties, frame: attached.frame,
      nodeWorld: (/** @type {string} */ id) => attached.scene.getNodeById(id)?.computeWorldMatrix(true) ?? null });
    layered.fill(NaN);
    write.fill(0);
    for (const i of given) write[i] = 1;
    const changed = state.changed.fill(0);
    for (const b of rig.changedBoneIndices()) {
      changed[b] = 1;
      const i = skeletonOf[b];
      if (i < 0) continue;
      write[i] = 1;
      for (const child of children[i]) write[child] = 1;
    }
    const posed = rig.pose, { local, swap, inverse, relative } = state;
    for (let i = 0; i < bones.length; i++) {
      if (!write[i]) continue;
      const b = of[i], parent = attached.shape[i].parent, p = parent >= 0 ? of[parent] : -1;
      if (p >= 0) {
        // The pose relative to the parent's (Blender's matrices), its rows and columns in Babylon's axes.
        invertAffine(inverse, 0, posed, p * 16);
        mulAffine(relative, 0, inverse, 0, posed, b * 16);
        swapAxes(relative, swap);
      } else {
        Matrix.FromArrayToRef(posed, b * 16, local);
        swapAxes(local.m, swap);
        swap.multiplyToRef(attached.space, swap);
      }
      if (!same(swap.m, written, i)) writeLocal(bones[i], swap, written, i);
    }
    // Each segment joint as the runtime shapes its B-Bone this frame, in its bone's space, where the bone or a bone its
    // handles follow changed.
    const ctx = bboneContext(rig), shaped = new Map();
    for (const { i, b, k, handles } of state.joints) {
      if (!handles.some((/** @type {number} */ h) => changed[h]) && !Number.isNaN(written[i * 16])) continue;
      if (!shaped.has(b)) shaped.set(b, bboneJoints(/** @type {any[]} */ (entry.program.bones)[b], ctx, false));
      swapAxes(shaped.get(b), swap, k * 16);
      if (!same(swap.m, written, i)) writeLocal(bones[i], swap, written, i);
    }
    // The page's layers on the solved pose (a foot lock, a look-at): what they write lasts this frame, for the skinned
    // meshes and, carried into the runtime's pose, for those it deforms.
    const solved = attached.skeleton.bylonderRig?.onSolved;
    if (!solved?.hasObservers()) return deform(entry, attached.native);
    solved.notifyObservers(attached.skeleton);
    const restore = layer(state, bones, attached.shape, posed);
    // The deform joints the runtime computed this evaluate from the pose before the layers, computed again.
    for (const joints of /** @type {any} */ (rig).cpuJoints?.values() ?? []) joints.pass = joints.dqPass = -1;
    deform(entry, attached.native);
    for (const [k, values] of restore) posed.set(values, k);
    for (const joints of /** @type {any} */ (rig).cpuJoints?.values() ?? []) joints.pass = joints.dqPass = -1;
  };
  /**
   * Keeps what onSolved's observers wrote into bones' local matrices as layered, and puts it into the runtime's pose:
   * each such bone posed by its parent's pose and the written local, the bones below it moved with it. Gives the pose
   * values it replaced, by offset, to restore after the deform.
   * @param {ReturnType<typeof directState>} state @param {any[]} bones @param {{ parent: number }[]} shape @param {Float64Array} posed
   */
  const layer = (state, bones, shape, posed) => {
    const { of, written, layered, inverse, relative } = state, moved = new Uint8Array(bones.length), restore = new Map();
    for (let i = 0; i < bones.length; i++) {
      const b = of[i], p = shape[i].parent >= 0 ? of[shape[i].parent] : -1;
      if (b < 0 || p < 0) continue;
      const m = bones[i]._matrix.m, own = !same(m, written, i);
      if (!own && !moved[shape[i].parent]) continue;
      if (own) layered.set(m, i * 16);
      // Blender's local of the bone: the written one, or the one it had below its parent before the layers.
      if (own) for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) relative[r * 4 + c] = m[AXIS_ORDER[r] * 4 + AXIS_ORDER[c]];
      else { invertAffine(inverse, 0, restore.get(p * 16) ?? posed, restore.has(p * 16) ? 0 : p * 16); mulAffine(relative, 0, inverse, 0, posed, b * 16); }
      if (!restore.has(b * 16)) restore.set(b * 16, posed.slice(b * 16, b * 16 + 16));
      mulAffine(posed, b * 16, posed, p * 16, relative, 0);
      moved[i] = 1;
    }
    return restore;
  };
  return Object.assign(solve, {
    pass,
    /** @param {NativePose['native']} native @param {string} name */
    deformed: (native, name) => deformMesh(entryOf(native).rig, deformOf(entryOf(native), name)),
  });
}

/** The page's implementation: pose-constraints.js on the native runtime. @param {any} page */
export const load = (page) => loadPose(page, /** @type {any} */ (nativeSolve(page.scene)));
