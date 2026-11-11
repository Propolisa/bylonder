// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `native-rig` solver of `constraints:POSE` entities: an armature's pose after its constraints and drivers by the
// clean room's rig runtime (native/, babylon-blender-rig), from the armature's `bylonder-rig` description
// (rig-description.js), run by pose-constraints.js in place of its own solvers: the same inputs and result as
// pose-kernels.js, each bone's Babylon local matrix by the skeleton's index.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { compileRig } from './native/rig/program.js';
import { swapped } from './constraints-evaluator.js';
import { unpackDescription } from './native-rig.js';
import { load as loadPose } from './pose-constraints.js';

/**
 * @typedef {{ bones: { name: string, parent: number, rest: Matrix }[], locals: Matrix[], mesh: Matrix, space: Matrix,
 *   native: { description: Uint8Array, arrays: ArrayLike<number>[], armature: string, objects?: Record<string, string> }, properties?: Record<string, number>,
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
  return { program, rig, armature: program.objectIndex.get(native.armature), layouts, properties: new Map(), placed: new Map(), posed: /** @type {Float64Array | null} */ (null) };
}

/** Places an object of the rig at a world matrix (Babylon's), where it moved. @param {ReturnType<typeof compile>} entry @param {number | undefined} index @param {Matrix} world */
function place(entry, index, world) {
  if (index === undefined) return;
  const m = swapped(world), key = Array.from(m.m).join();
  if (entry.placed.get(index) === key) return;
  entry.placed.set(index, key);
  entry.rig.setObjectBasis(index, Float64Array.from(m.m));
}

/**
 * The solver: `solve(pose)` gives each bone's Babylon local matrix after the rig's constraints and drivers.
 * @returns {(pose: NativePose) => Map<number, Matrix>}
 */
export function nativeSolve() {
  /** Each rig by the description it was compiled from. @type {WeakMap<Uint8Array, ReturnType<typeof compile>>} */
  const rigs = new WeakMap();
  const scale = new Vector3(), turn = new Quaternion(), at = new Vector3();
  return ({ bones, locals, mesh, space, native, properties = {}, frame = 0, nodeWorld = () => null }) => {
    if (!rigs.has(native.description)) rigs.set(native.description, compile(native));
    const entry = /** @type {ReturnType<typeof compile>} */ (rigs.get(native.description)), { program, rig } = entry;
    // The skeleton's bones in the rig, and their inverted rests, found once per skeleton.
    if (!entry.layouts.has(bones)) {
      const index = program.objects[entry.armature].boneIndex;
      entry.layouts.set(bones, { of: bones.map((b) => /** @type {number} */ (index.get(b.name) ?? -1)), unrest: bones.map((b) => Matrix.Invert(b.rest)), last: [] });
    }
    const { of, unrest, last } = /** @type {{ of: number[], unrest: Matrix[], last: Matrix[] }} */ (entry.layouts.get(bones));
    // Each bone's own location, rotation and scale (Blender's axes), as the page or its animation set them, where they
    // changed: the runtime then reruns only what depends on them.
    of.forEach((b, i) => {
      if (b < 0 || last[i]?.equals(locals[i])) return;
      last[i] = locals[i].clone();
      swapped(locals[i].multiply(unrest[i])).decompose(scale, turn, at);
      rig.setBonePose(b, { location: at.asArray(), rotation_mode: 'QUATERNION', rotation_quaternion: [turn.w, turn.x, turn.y, turn.z], scale: scale.asArray() });
    });
    // The custom properties drivers read (`["name"]` of the armature, `pose.bones["B"]["name"]` of a bone), when set.
    for (const [path, value] of Object.entries(properties)) {
      if (entry.properties.get(path) === value) continue;
      entry.properties.set(path, value);
      rig.setPath(native.armature, path, value);
    }
    // The armature and the objects its constraints read where the page places them (Blender's axes).
    place(entry, entry.armature, space.multiply(mesh));
    for (const [name, id] of Object.entries(native.objects ?? {})) { const world = nodeWorld(id); if (world) place(entry, program.objectIndex.get(name), world); }
    rig.setFrame(frame);
    rig.evaluate();
    // The bones whose pose or parent's pose changed since the last solve: the others keep the matrices they were given.
    /** @type {Map<number, Matrix>} */
    const result = new Map(), posed = rig.pose, before = entry.posed ?? new Float64Array(posed.length).fill(NaN);
    const moved = (/** @type {number} */ b) => { for (let k = b * 16; k < b * 16 + 16; k++) if (posed[k] !== before[k]) return true; return false; };
    of.forEach((b, i) => {
      if (b < 0 || !(moved(b) || (bones[i].parent >= 0 && of[bones[i].parent] >= 0 && moved(of[bones[i].parent])))) return;
      const own = Matrix.FromArray(posed, b * 16), parent = bones[i].parent >= 0 ? of[bones[i].parent] : -1;
      result.set(i, parent < 0 ? swapped(own).multiply(space) : swapped(own.multiply(Matrix.Invert(Matrix.FromArray(posed, parent * 16)))));
    });
    entry.posed = Float64Array.from(posed);
    return result;
  };
}

/** The page's implementation: pose-constraints.js on the native runtime. @param {any} page */
export const load = (page) => loadPose(page, /** @type {any} */ (nativeSolve()));
