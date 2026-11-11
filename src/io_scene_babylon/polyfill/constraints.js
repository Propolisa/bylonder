// The constraint kernels' loader (bundled into constraints-kernels.bundle.js by scripts/modifiers-polyfill.mjs, shipped
// next to constraints.wasm): Blender's object and bone constraints (constraint-api.cc), a rig's bones, pose bones and
// constraints written at the DNA offsets of their RNA properties (layouts from dna-constraints.json, given with the
// export), its pose evaluated as Main's is. A constraint type's kernel can be handed to a unit of the page's (`use`).
import { instantiate, provided, size } from '../../port/wasm.js';
import { writeValues } from '../../modifiers/dna-write.js';

// Blender's constraint types (eBConstraint_Types) by RNA identifier.
export const CONSTRAINT_TYPES = {
  CHILD_OF: 1, TRACK_TO: 2, IK: 3, FOLLOW_PATH: 4, LIMIT_ROTATION: 5, LIMIT_LOCATION: 6, LIMIT_SCALE: 7, COPY_ROTATION: 8,
  COPY_LOCATION: 9, COPY_SCALE: 10, ACTION: 12, LOCKED_TRACK: 13, LIMIT_DISTANCE: 14, STRETCH_TO: 15, FLOOR: 16, CLAMP_TO: 18,
  TRANSFORM: 19, SHRINKWRAP: 20, DAMPED_TRACK: 21, SPLINE_IK: 22, COPY_TRANSFORMS: 23, MAINTAIN_VOLUME: 24, PIVOT: 25,
  FOLLOW_TRACK: 26, CAMERA_SOLVER: 27, OBJECT_SOLVER: 28, TRANSFORM_CACHE: 29, ARMATURE: 30, GEOMETRY_ATTRIBUTE: 31,
};
const TYPE_NAMES = Object.fromEntries(Object.entries(CONSTRAINT_TYPES).map(([name, type]) => [type, name]));
// The types whose kernels need only matrices: the others read curves, meshes, actions, movie clips or caches.
export const MATRIX_ONLY = new Set(['CHILD_OF', 'TRACK_TO', 'IK', 'LIMIT_ROTATION', 'LIMIT_LOCATION', 'LIMIT_SCALE', 'COPY_ROTATION',
  'COPY_LOCATION', 'COPY_SCALE', 'LOCKED_TRACK', 'LIMIT_DISTANCE', 'STRETCH_TO', 'FLOOR', 'TRANSFORM', 'DAMPED_TRACK',
  'COPY_TRANSFORMS', 'MAINTAIN_VOLUME', 'PIVOT', 'ARMATURE']);

// Settings by path (`use_x`, `head_tail`, `matrix[3]`), as writeValues takes them.
const paths = (values) => Object.fromEntries(Object.entries(values).flatMap(([name, value]) => (Array.isArray(value)
  ? value.flat(Infinity).map((v, i) => [`${name}[${i}]`, v]) : [[name, value]])));

/**
 * The kernels of a constraints.wasm.
 * @param {URL} url
 */
export async function loadConstraints(url) {
  const heap = await instantiate(url), x = heap.exports;
  const dataView = () => new DataView(x.memory.buffer);
  const write = (address, layouts, values) => writeValues(dataView(), address, layouts ?? {}, paths(values ?? {}));
  const floats = (ptr, count) => new Float32Array(x.memory.buffer, ptr >>> 0, count);
  const text = (string) => {
    const bytes = new TextEncoder().encode(`${string}\0`);
    heap.reserve(size(bytes));
    return heap.in(bytes);
  };
  const setMatrix = (ob, matrix) => {
    heap.reserve(64);
    x.object_matrix_set(ob, heap.in(Float32Array.from(matrix)));
  };

  // Each constraint's settings by its address, for a unit given its evaluation.
  const settingsOf = new Map();
  // The units the page gave constraint types' evaluation to, by type.
  const units = new Map();
  provided.constraint_unit = (type, con, owner, count, targets) => {
    const matrix = units.get(type)({ owner: Array.from(floats(owner, 16)), targets: Array.from({ length: count }, (_, i) => Array.from(floats(targets + i * 64, 16))),
      settings: settingsOf.get(con >>> 0) ?? {} });
    floats(owner, 16).set(matrix);
  };

  /**
   * Adds a stack's constraints to an owner (a pose bone, or null for the object), each a type's settings by RNA name
   * and its targets (`{ node }`, an object the page places, or `{ bone }`, a bone of the rig); gives their addresses.
   * @param {number} ob @param {number} pchan @param {any[]} constraints @param {Record<string, any>} layouts
   * @param {(target: any) => [number, string]} resolve an object and bone name
   */
  function addStack(ob, pchan, constraints, layouts, resolve) {
    return constraints.map((c) => {
      const con = x.constraint_add(ob, pchan, CONSTRAINT_TYPES[c.type]) >>> 0;
      if (!con) throw new Error(`Blender's ${c.type} constraint is not in this module`);
      write(con, layouts.Constraint, c.constraint);
      write(x.constraint_data(con) >>> 0, layouts[c.struct], c.settings);
      settingsOf.set(con, { ...c.constraint, ...c.settings });
      (c.targets ?? []).forEach((target, i) => {
        if (!target) return;
        const [object, bone] = resolve(target);
        x.constraint_target_set(con, i, object, bone ? text(bone) : 0);
      });
      for (const { target, weight } of c.armature_targets ?? []) {
        const [object, bone] = resolve(target);
        write(x.constraint_target_add(con, object, bone ? text(bone) : 0) >>> 0, layouts.ConstraintTargetBone, { weight });
      }
      return con;
    });
  }

  // Empty objects standing for the page's nodes a stack targets, placed before each evaluation.
  const nodeTargets = () => {
    const objects = new Map();
    return {
      object: (node) => objects.get(node) ?? objects.set(node, x.object_new()).get(node),
      place: (matrixOf) => objects.forEach((ob, node) => setMatrix(ob, matrixOf(node))),
      free: () => objects.forEach((ob) => x.object_free(ob)),
    };
  };

  return {
    /**
     * A rig: its bones (name, parent index, Bone and PoseBone settings, constraints), the Armature's and Pose's settings.
     * `evaluate` takes each bone's channel matrix (its own location, rotation and scale; column-major, 16 floats per
     * bone), the armature object's world matrix and the target nodes' (by id), and gives each bone's pose matrix.
     */
    rig({ bones, armature, pose, layouts }) {
      const names = new TextEncoder().encode(`${bones.map((b) => b.name).join('\n')}\n\0`), parents = Int32Array.from(bones, (b) => b.parent);
      heap.reserve(size(names) + size(parents));
      const rig = x.rig_new(bones.length, heap.in(parents), heap.in(names)), ob = x.rig_object(rig), targets = nodeTargets();
      write(x.rig_armature(rig) >>> 0, layouts.Armature, armature);
      bones.forEach((b, i) => {
        write(x.rig_bone(rig, i) >>> 0, layouts.Bone, b.bone);
        write(x.rig_pose_bone(rig, i) >>> 0, layouts.PoseBone, b.pose);
        if (b.handles) x.rig_bone_handles(rig, i, ...b.handles);
      });
      write(x.rig_pose(rig) >>> 0, layouts.Pose, pose);
      const resolve = (t) => ('bone' in t && !('node' in t) ? [ob, t.bone] : [targets.object(t.node), t.bone]);
      // Each bone's constraints, for their influences to be set.
      const stacks = bones.map((b, i) => addStack(ob, x.rig_pose_bone(rig, i), b.constraints ?? [], layouts, resolve));
      x.rig_update(rig);
      const channels = new Float32Array(bones.length * 16);
      // What pose and influence last wrote, so that only a change is written again.
      const posed = new Map(), influenced = new Map();
      const same = (a, b) => !!a && Object.keys(b).every((key) => (Array.isArray(b[key]) ? b[key].every((v, j) => v === a[key][j]) : b[key] === a[key]));
      return {
        /** A pose bone's own settings (location, rotation, scale by RNA name), as an animation sets them. */
        pose(i, values) {
          if (same(posed.get(i), values)) return;
          posed.set(i, structuredClone(values));
          write(x.rig_pose_bone(rig, i) >>> 0, layouts.PoseBone, values);
        },
        /** A constraint's influence, the `k`th of bone `i`'s, as a driver or the page sets it. */
        influence(i, k, value) {
          if (!stacks[i]?.[k] || influenced.get(stacks[i][k]) === value) return;
          influenced.set(stacks[i][k], value);
          write(stacks[i][k], layouts.Constraint, { influence: value });
        },
        /** With `local` null, each bone's own settings are those `pose` last wrote. */
        evaluate(frame, local, world, matrixOf) {
          targets.place(matrixOf);
          setMatrix(ob, world);
          if (local) {
            channels.set(local);
            heap.reserve(channels.byteLength);
            x.rig_channels_set(rig, heap.in(channels));
          }
          return floats(x.rig_evaluate(rig, frame), bones.length * 16).slice();
        },
        /**
         * A B-Bone's segments after the last evaluation, its segments' matrices in the bone's rest space (Blender's
         * bbone_segment_matrix), posed and at rest.
         */
        bboneSegments(i) {
          const header = x.rig_bbone_segments(rig, i) >>> 0, view = dataView(), count = view.getInt32(header, true);
          const read = (at) => Array.from({ length: count }, (_, k) => floats(view.getUint32(header + at, true) + k * 64, 16).slice());
          // The rest matrices only when asked: a page reads the posed ones each frame.
          return { matrices: read(4), get rest_matrices() { return read(8); } };
        },
        free() {
          targets.free();
          x.rig_free(rig);
        },
      };
    },
    /**
     * An object's constraints: `evaluate` takes its world matrix before them and its target nodes' (by id), and gives
     * its world matrix after them.
     */
    object({ constraints, layouts }) {
      const ob = x.object_new(), targets = nodeTargets();
      addStack(ob, 0, constraints, layouts, (t) => [targets.object(t.node), t.bone]);
      return {
        evaluate(frame, world, matrixOf) {
          targets.place(matrixOf);
          setMatrix(ob, world);
          return floats(x.object_constraints_evaluate(ob, frame), 16).slice();
        },
        free() {
          targets.free();
          x.object_free(ob);
        },
      };
    },
    /**
     * Hands a constraint type's evaluation to a unit (`run({ owner, targets, settings })` giving the owner's matrix,
     * all in the constraint's spaces as Blender converts them), or back to Blender's kernel with none.
     * @param {string} type @param {{ run(inputs: any): ArrayLike<number> } | null} unit
     */
    use(type, unit) {
      if (unit) units.set(CONSTRAINT_TYPES[type], (inputs) => unit.run(inputs));
      else units.delete(CONSTRAINT_TYPES[type]);
      return !!x.constraint_unit_use(CONSTRAINT_TYPES[type], !!unit);
    },
    typeName: (type) => TYPE_NAMES[type],
  };
}
