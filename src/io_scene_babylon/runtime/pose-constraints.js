// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `pose` implementation of `constraints:POSE` entities: an armature's bone constraints run live in the page, so a
// rig follows its IK targets, poles and look-at targets as the animation, the control panel or a game's code moves
// them. Written from Blender's manual and the poses Blender evaluates (the export keeps a stack only where this gives
// Main's pose at every frame it samples), not from Blender's code. Each constraint type runs on the unit registered for
// `constraint:<TYPE>` (units.js), else on its own solver here. Not yet audited as clean-room code; a clean-room
// constraints plugin is to replace it.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { unitFor } from './units.js';
import { swapped, trackTo } from './constraints-evaluator.js';

/**
 * Where a constraint reads its target: a bone of the armature (at `head_tail` along it), or an object's node.
 * @typedef {{ bone: string } | { node: string }} Target
 * A bone constraint as the export writes it, in Blender's terms. IK names its chain's bones, root first.
 * @typedef {{ type: string, influence: number, target?: Target, pole?: Target, pole_angle?: number, chain?: string[],
 *   head_tail?: number, track_axis?: string, up_axis?: string, use_target_z?: boolean, owner_space?: string,
 *   target_space?: string, euler_order?: string, limits?: ([number, number] | null)[] }} PoseConstraint
 * The pose to solve, in Babylon's matrices: each bone's parent (an index before it, or -1), rest matrix relative to its
 * parent (Bone.getRestMatrix), length and rotation mode; each bone's local matrix before its constraints (its
 * location, rotation and scale, then its rest: Bone's _matrix); the skinned mesh's world matrix, the armature's matrix relative to it, each bone's constraints, and
 * a node's world matrix by id.
 * @typedef {{ bones: { name: string, parent: number, rest: Matrix, length: number, mode: string }[], locals: Matrix[],
 *   mesh: Matrix, space: Matrix, stacks: Record<string, PoseConstraint[]>, nodeWorld: (id: string) => Matrix | null }} Pose
 */

const AXES = ['X', 'Y', 'Z'];
const row = (/** @type {Matrix} */ m, /** @type {number} */ i) => new Vector3(m.m[i * 4], m.m[i * 4 + 1], m.m[i * 4 + 2]);
const fromRows = (/** @type {Vector3[]} */ axes, /** @type {Vector3} */ at) => Matrix.FromArray([...axes.flatMap((a) => [a.x, a.y, a.z, 0]), at.x, at.y, at.z, 1]);
const head = (/** @type {Matrix} */ m) => row(m, 3);
const inverse = (/** @type {Matrix} */ m) => Matrix.Invert(m);

/**
 * A matrix turned by `q` about `pivot`: its axes turned, its origin moved round the pivot.
 * @param {Matrix} m @param {Quaternion} q @param {Vector3} pivot
 */
function turned(m, q, pivot) {
  const axes = [0, 1, 2].map((i) => row(m, i).applyRotationQuaternion(q));
  return fromRows(axes, pivot.add(head(m).subtract(pivot).applyRotationQuaternion(q)));
}

/** The shortest turn from one direction to another. @param {Vector3} from @param {Vector3} to */
function arc(from, to) {
  const q = new Quaternion();
  Quaternion.FromUnitVectorsToRef(from.normalizeToNew(), to.normalizeToNew(), q);
  return q;
}

/** A matrix's axes without scale, and their scales. @param {Matrix} m */
function unscaled(m) {
  const scale = [0, 1, 2].map((i) => row(m, i).length());
  return { axes: [0, 1, 2].map((i) => row(m, i).scale(1 / (scale[i] || 1))), scale };
}

// Euler angles in Blender's orders: `XYZ` turns about X first, then Y, then Z, about fixed axes.
const unit = (/** @type {number} */ axis) => new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
const axisTurn = (/** @type {number} */ axis, /** @type {number} */ angle) => Quaternion.RotationAxis(unit(axis), angle);
/** The turn of Euler angles in an order. @param {number[]} angles @param {string} order */
function fromEuler(angles, order) {
  return [...order].reduce((q, name) => { const i = AXES.indexOf(name); return axisTurn(i, angles[i]).multiply(q); }, Quaternion.Identity());
}
/**
 * The Euler angles of a turn in an order, of the two that give it the one with the smaller sum of magnitudes.
 * @param {Vector3[]} axes the turned X, Y and Z axes @param {string} order
 */
function toEuler(axes, order) {
  const [i, j, k] = [...order].map((name) => AXES.indexOf(name)), sign = (j - i + 3) % 3 === 1 ? 1 : -1;
  // m(r, c): row r, column c of the turn as it acts on column vectors; axes[c] is its column c.
  const m = (/** @type {number} */ r, /** @type {number} */ c) => axes[c].asArray()[r];
  const cy = Math.hypot(m(i, i), m(j, i)), angles = [0, 0, 0], other = [0, 0, 0];
  if (cy > 1e-6) {
    angles[i] = Math.atan2(sign * m(k, j), m(k, k));
    angles[j] = Math.atan2(-sign * m(k, i), cy);
    angles[k] = Math.atan2(sign * m(j, i), m(i, i));
    other[i] = Math.atan2(-sign * m(k, j), -m(k, k));
    other[j] = Math.atan2(-sign * m(k, i), -cy);
    other[k] = Math.atan2(-sign * m(j, i), -m(i, i));
  } else {
    angles[i] = other[i] = Math.atan2(-sign * m(j, k), m(j, j));
    angles[j] = other[j] = Math.atan2(-sign * m(k, i), cy);
  }
  const size = (/** @type {number[]} */ a) => a.reduce((s, v) => s + Math.abs(v), 0);
  return size(angles) > size(other) ? other : angles;
}

/** An angle wrapped into [-π, π). @param {number} a */
const wrap = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
/**
 * An angle within a limit, as Limit Rotation keeps it: taken nearest the middle of the range, then to the nearer end.
 * @param {number} angle @param {[number, number]} limit
 */
function limited(angle, [min, max]) {
  if (max - min >= 2 * Math.PI) return angle;
  const middle = (min + max) / 2, near = wrap(angle - middle) + middle;
  if (near >= min && near <= max) return near;
  return Math.abs(wrap(near - min)) < Math.abs(wrap(near - max)) ? min : max;
}

/**
 * Two matrices mixed by `t`: their turns along the shortest arc, their scales and places in a line.
 * @param {Matrix} a @param {Matrix} b @param {number} t
 */
function mixed(a, b, t) {
  const [sa, sb, ta, tb] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()], [qa, qb] = [new Quaternion(), new Quaternion()];
  a.decompose(sa, qa, ta);
  b.decompose(sb, qb, tb);
  return Matrix.Compose(Vector3.Lerp(sa, sb, t), Quaternion.Slerp(qa, qb, t), Vector3.Lerp(ta, tb, t));
}

/**
 * The bone constraints' solvers, each on Blender's matrices (axes as rows, Blender's world axes): `owner` the owner's
 * matrix in its space and `target` its target's in the target's.
 * @type {Record<string, (owner: Matrix, target: Matrix | null, c: PoseConstraint, mode: string) => Matrix>}
 */
const SOLVERS = {
  DAMPED_TRACK(owner, target, c) {
    if (!target) return owner;
    const axis = AXES.indexOf(/** @type {string} */ (c.track_axis).slice(-1)), toward = head(target).subtract(head(owner));
    if (toward.lengthSquared() < 1e-12) return owner;
    const from = row(owner, axis).scale(c.track_axis?.includes('NEGATIVE') ? -1 : 1);
    return turned(owner, arc(from, toward), head(owner));
  },
  TRACK_TO: (owner, target, c) => (target ? trackTo(owner, target, /** @type {any} */ (c)) : owner),
  COPY_ROTATION(owner, target) {
    if (!target) return owner;
    const { scale } = unscaled(owner), { axes } = unscaled(target);
    return fromRows(axes.map((a, i) => a.scale(scale[i])), head(owner));
  },
  LIMIT_ROTATION(owner, target, c, mode) {
    const { axes, scale } = unscaled(owner), order = c.euler_order && c.euler_order !== 'AUTO' ? c.euler_order : AXES.join('').includes(mode) && mode.length === 3 ? mode : 'XYZ';
    const angles = toEuler(axes, order).map((a, i) => (c.limits?.[i] ? limited(a, /** @type {[number, number]} */ (c.limits[i])) : a));
    const turn = fromEuler(angles, order);
    return fromRows([0, 1, 2].map((i) => unit(i).applyRotationQuaternion(turn).scale(scale[i])), head(owner));
  },
};

/**
 * The turn about a chain's root that points its end at the goal and, with a pole, turns it about the line to the goal
 * until the root's X axis turned by the pole angle about its Y axis faces the pole.
 * @param {Matrix} root @param {Vector3} end @param {Vector3} toward @param {Vector3 | null} pole @param {number} poleAngle
 */
function aimed(root, end, toward, pole, poleAngle) {
  const turn = arc(end, toward);
  if (!pole) return turn;
  const along = toward.normalizeToNew(), flat = (/** @type {Vector3} */ v) => v.subtract(along.scale(Vector3.Dot(v, along)));
  const x = row(root, 0).applyRotationQuaternion(turn), z = row(root, 2).applyRotationQuaternion(turn);
  const up = flat(x.scale(Math.cos(poleAngle)).add(z.scale(Math.sin(poleAngle)))), facing = flat(pole.subtract(head(root)));
  if (up.lengthSquared() < 1e-12 || facing.lengthSquared() < 1e-12) return turn;
  return Quaternion.RotationAxis(along, Math.atan2(Vector3.Dot(Vector3.Cross(up, facing), along), Vector3.Dot(up, facing))).multiply(turn);
}

/** A chain's root-to-end vector, and its two parts for a chain of two. @param {Matrix[]} chain @param {number[]} lengths */
function span(chain, lengths) {
  const last = chain.length - 1, lower = row(chain[last], 1).normalize().scale(lengths[last]);
  const upper = last ? head(chain[last]).subtract(head(chain[0])) : Vector3.Zero();
  return { upper, lower, end: upper.add(lower) };
}

/**
 * Turns an IK chain (Blender's matrices, root first) so that its tip's tail reaches `goal`: the chain as posed turned
 * as one about its root to point at the goal (and face the pole), then, for a chain of two, bent at its middle joint
 * in the plane it bends in and turned in that plane until its end is on the goal.
 * @param {Matrix[]} chain @param {number[]} lengths @param {Vector3} goal @param {Vector3 | null} pole @param {number} poleAngle
 */
export function reach(chain, lengths, goal, pole, poleAngle) {
  const root = head(chain[0]), toward = goal.subtract(root);
  if (toward.lengthSquared() < 1e-12) return chain;
  const turn = aimed(chain[0], span(chain, lengths).end, toward, pole, poleAngle), out = chain.map((m) => turned(m, turn, root));
  if (out.length !== 2) return out;
  const { upper, lower } = span(out, lengths), a = upper.length(), b = lower.length();
  let axis = Vector3.Cross(upper, lower);
  if (axis.lengthSquared() < 1e-12) axis = row(out[0], 0);
  axis.normalize();
  const bent = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(upper, lower) / (a * b))));
  const distance = Math.max(Math.abs(a - b), Math.min(a + b, toward.length()));
  const bend = Quaternion.RotationAxis(axis, Math.acos(Math.max(-1, Math.min(1, (distance * distance - a * a - b * b) / (2 * a * b)))) - bent);
  out[1] = turned(out[1], bend, head(out[1]));
  const settle = arc(upper.add(lower.applyRotationQuaternion(bend)), toward);
  return out.map((m) => turned(m, settle, root));
}

/**
 * An armature's pose after its bone constraints: the Babylon local matrix of each bone they move, by index. Bones are
 * placed parents first, a constraint's targets before it, an IK chain once its root and the bones down to its tip
 * are placed with their own constraints (Blender's order).
 * @param {Pose} pose
 * @returns {Map<number, Matrix>}
 */
export function solvePose({ bones, locals, mesh, space, stacks, nodeWorld }) {
  const index = new Map(bones.map((b, i) => [b.name, i])), rests = bones.map((b) => swapped(b.rest)), local = locals.map(swapped);
  const meshWorld = swapped(mesh), armature = swapped(space).multiply(meshWorld);
  /** @type {Matrix[]} */
  const world = [], done = new Set(), busy = new Set(), moved = new Set();
  const parentWorld = (/** @type {number} */ i) => (bones[i].parent < 0 ? meshWorld : world[bones[i].parent] ?? meshWorld);
  const stackOf = (/** @type {number} */ i) => stacks[bones[i].name] ?? [];
  /** IK constraints by their chain's root. @type {Map<number, PoseConstraint[]>} */
  const chains = new Map();
  for (const [name, stack] of Object.entries(stacks)) for (const c of stack) if (c.type === 'IK' && c.chain && index.has(c.chain[0])) {
    const root = /** @type {number} */ (index.get(c.chain[0]));
    chains.set(root, [...(chains.get(root) ?? []), { ...c, chain: c.chain.filter((n) => index.has(n)) }]);
  }

  /** A target's matrix in world space (Blender's axes). @param {Target | undefined} target */
  const targetWorld = (target) => {
    if (!target) return null;
    if ('node' in target) { const m = nodeWorld(target.node); return m && swapped(m); }
    const i = index.get(target.bone);
    if (i === undefined) return null;
    place(i);
    return world[i];
  };
  /** @param {Target | undefined} target @param {number} along */
  const targetPoint = (target, along = 0) => {
    const m = targetWorld(target);
    if (!m || !target || !('bone' in target) || !along) return m;
    const i = /** @type {number} */ (index.get(target.bone)), at = head(m).add(row(m, 1).normalize().scale(bones[i].length * along));
    return fromRows([0, 1, 2].map((k) => row(m, k)), at);
  };
  /** A matrix in a bone's space, and back. @param {Matrix} m @param {number} i @param {string | undefined} name */
  const toSpace = (m, i, name) => (name === 'POSE' ? m.multiply(inverse(armature)) : name === 'LOCAL' && i >= 0 ? m.multiply(inverse(parentWorld(i))).multiply(inverse(rests[i])) : m);
  /** @param {Matrix} m @param {number} i @param {string | undefined} name */
  const fromSpace = (m, i, name) => (name === 'POSE' ? m.multiply(armature) : name === 'LOCAL' && i >= 0 ? m.multiply(rests[i]).multiply(parentWorld(i)) : m);

  /** A bone's world matrix after its own constraints but IK. @param {number} i */
  const constrained = (i) => stackOf(i).filter((c) => c.type !== 'IK').reduce((m, c) => {
    const target = targetPoint(c.target, c.head_tail ?? 0), j = c.target && 'bone' in c.target ? index.get(c.target.bone) ?? -1 : -1;
    const unit = unitFor(`constraint:${c.type}`), solver = SOLVERS[c.type];
    if (!unit && !solver) return m;
    const owner = toSpace(m, i, c.owner_space), seen = target && toSpace(target, j, c.target_space);
    const result = unit ? Matrix.FromArray(/** @type {any} */ (unit.run({ owner: owner.asArray(), target: seen?.asArray() ?? null, settings: c }, { frame: 0 })).matrix)
      : solver(owner, seen, c, bones[i].mode);
    const placed = fromSpace(result, i, c.owner_space);
    moved.add(i);
    return c.influence < 1 ? mixed(m, placed, c.influence) : placed;
  }, local[i].multiply(parentWorld(i)));

  /** Places a bone, and the IK chains rooted at it. @param {number} i */
  function place(i) {
    if (done.has(i) || busy.has(i)) return;
    busy.add(i);
    if (bones[i].parent >= 0) place(bones[i].parent);
    if (done.has(i)) return;
    const iks = chains.get(i) ?? [];
    for (const c of [i, ...iks.flatMap((ik) => (ik.chain ?? []).map((n) => /** @type {number} */ (index.get(n))))].flatMap(stackOf)) {
      targetWorld(c.target);
      targetWorld(c.pole);
    }
    world[i] = constrained(i);
    for (const ik of iks) solveChain(ik);
    done.add(i);
    busy.delete(i);
  }

  /** Places an IK chain's bones below its root with their own constraints, then reaches. @param {PoseConstraint} ik */
  function solveChain(ik) {
    const chain = (ik.chain ?? []).map((n) => /** @type {number} */ (index.get(n)));
    for (const i of chain.slice(1)) { world[i] = constrained(i); done.add(i); }
    const goal = targetWorld(ik.target), pole = targetWorld(ik.pole);
    if (!goal) return;
    const tip = world[chain.at(-1) ?? 0], tail = head(tip).add(row(tip, 1).normalize().scale(bones[chain.at(-1) ?? 0].length));
    const aim = Vector3.Lerp(tail, head(goal), ik.influence);
    const unit = unitFor('constraint:IK'), matrices = chain.map((i) => world[i]), lengths = chain.map((i) => bones[i].length);
    const reached = unit
      ? /** @type {number[][]} */ (/** @type {any} */ (unit.run({ chain: matrices.map((m) => m.asArray()), lengths, goal: aim.asArray(), pole: pole && head(pole).asArray(), settings: ik }, { frame: 0 })).chain).map((m) => Matrix.FromArray(m))
      : reach(matrices, lengths, aim, pole && head(pole), ik.pole_angle ?? 0);
    chain.forEach((i, k) => { world[i] = reached[k]; moved.add(i); });
  }

  bones.forEach((_, i) => place(i));
  return new Map([...moved].map((i) => [i, swapped(world[i].multiply(inverse(parentWorld(i))))]));
}

/** Each skeleton's live pose, once per scene. */
const scenes = new WeakMap();

/**
 * Runs an armature's bone constraints before each frame draws, from each bone's own pose: what the page or its
 * animation last set, else what it had before the constraints last moved it.
 * @param {Record<string, any>} inputs `skeleton`, `mesh`, `space`, `bones` (`length`, `mode`, `own` by name) and `constraints` by bone
 * @param {object} entity
 * @param {import('@babylonjs/core').Scene} scene
 */
function attach(inputs, entity, scene) {
  if (!scenes.has(scene)) {
    const list = /** @type {any[]} */ ([]);
    scenes.set(scene, list);
    scene.onBeforeRenderObservable.add(() => list.forEach(apply));
  }
  const list = scenes.get(scene), found = list.find((/** @type {any} */ e) => e.entity === entity);
  if (found) { found.stacks = inputs.constraints; return {}; }
  const skeleton = scene.getSkeletonById(inputs.skeleton), mesh = scene.getMeshById(inputs.mesh);
  if (!skeleton || !mesh) return {};
  const bones = skeleton.bones, entry = { entity, skeleton, mesh, scene, space: Matrix.FromArray(inputs.space), stacks: inputs.constraints,
    shape: bones.map((bone) => ({ name: bone.name, parent: bone.getParent() ? bones.indexOf(/** @type {any} */ (bone.getParent())) : -1, rest: bone.getRestMatrix(),
      length: inputs.bones[bone.name]?.length ?? 0, mode: inputs.bones[bone.name]?.mode ?? 'QUATERNION' })),
    own: new Map(), placed: new Map() };
  for (const [name, { own }] of Object.entries(inputs.bones)) {
    const bone = bones.find((b) => b.name === name);
    if (own && bone) bone._matrix = Matrix.FromArray(own);
  }
  list.push(entry);
  return {};
}

/**
 * Poses a skeleton's constrained bones: each one's own matrix is what was set on it since, else the one it had.
 * @param {any} entry
 */
function apply(entry) {
  const bones = entry.skeleton.bones;
  const locals = bones.map((/** @type {any} */ bone, /** @type {number} */ i) => {
    const current = bone._matrix.clone(), placed = entry.placed.get(i);
    if (!placed || !current.equalsWithEpsilon(placed, 1e-7)) entry.own.set(i, current);
    return entry.own.get(i) ?? current;
  });
  const moved = solvePose({ bones: entry.shape, locals, mesh: entry.mesh.computeWorldMatrix(true), space: entry.space, stacks: entry.stacks,
    nodeWorld: (id) => entry.scene.getNodeById(id)?.computeWorldMatrix(true) ?? null });
  entry.placed.clear();
  for (const [i, local] of moved) {
    bones[i]._matrix = local;
    entry.placed.set(i, local.clone());
  }
}

/** @param {{ scene: import('@babylonjs/core').Scene }} page */
export function load({ scene }) {
  return { run: (/** @type {any} */ inputs, /** @type {any} */ context, /** @type {object} */ entity) => attach(inputs, entity, scene) };
}
