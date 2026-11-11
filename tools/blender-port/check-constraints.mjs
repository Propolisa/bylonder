// The constraint kernels module's check (manifest `check`, run by wasm_module.py after linking): a chain of three bones
// along Y whose tip reaches an empty by IK (with a pole), turned by Damped Track, Copy Rotation, Limit Rotation and
// Stretch To, and an object under Child Of and Track To, each evaluated with both IK solvers; prints a digest of each
// pose. The build runs it on the module and on copies linked with their data moved, which must print the same.
// usage: node tools/blender-port/check-constraints.mjs MODULE.wasm
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConstraints } from '../../src/io_scene_babylon/polyfill/constraints.js';
import { layoutsOf } from '../../src/io_scene_babylon/rig-layouts.js';

const kernels = await loadConstraints(pathToFileURL(resolve(process.argv[2])));
const layouts = Object.fromEntries(['Constraint', 'ConstraintTarget', 'ConstraintTargetBone', 'Bone', 'PoseBone', 'Pose', 'Armature', 'KinematicConstraint',
  'DampedTrackConstraint', 'CopyRotationConstraint', 'LimitRotationConstraint', 'StretchToConstraint', 'ChildOfConstraint', 'TrackToConstraint']
  .map((struct) => [struct, layoutsOf(struct)]));
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const bone = (y) => ({ head: [0, 0, 0], tail: [0, 1, 0], head_local: [0, y, 0], tail_local: [0, y + 1, 0], length: 1, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  matrix_local: translation(0, y, 0), bbone_segments: 1, inherit_scale: 'FULL', use_inherit_rotation: true, use_connect: y > 0 });
const constraint = (type, struct, settings, targets = [], constraint = {}) => ({ type, struct, settings, targets, constraint: { influence: 1, owner_space: 'WORLD', target_space: 'WORLD', ...constraint } });
const targets = { goal: translation(1.5, 1, 0.5), pole: translation(0, 1, -2), look: translation(-2, 3, 1) };
const digest = (floats) => createHash('sha1').update(new Uint8Array(floats.buffer)).digest('hex').slice(0, 12);

for (const solver of ['LEGACY', 'ITASC']) {
  const rig = kernels.rig({
    layouts, armature: {}, pose: { ik_solver: solver },
    bones: [
      { name: 'root', parent: -1, bone: bone(0), pose: {}, constraints: [constraint('COPY_ROTATION', 'CopyRotationConstraint', { use_x: true, use_y: true, use_z: true, mix_mode: 'REPLACE' }, [{ node: 'look' }], { influence: 0.3 })] },
      { name: 'mid', parent: 0, bone: bone(1), pose: { rotation_mode: 1, rotation_euler: [0.4, 0, 0.2] }, constraints: [
        constraint('LIMIT_ROTATION', 'LimitRotationConstraint', { use_limit_x: true, min_x: -0.2, max_x: 0.2 }, [], { owner_space: 'LOCAL' })] },
      { name: 'tip', parent: 1, bone: bone(2), pose: {}, constraints: [
        constraint('IK', 'KinematicConstraint', { chain_count: 2, use_tail: true, pole_angle: 0.3, iterations: 500 }, [{ node: 'goal' }, { node: 'pole' }])] },
      { name: 'aim', parent: 2, bone: bone(3), pose: {}, constraints: [constraint('DAMPED_TRACK', 'DampedTrackConstraint', { track_axis: 'TRACK_Y' }, [{ node: 'look' }]),
        constraint('STRETCH_TO', 'StretchToConstraint', { rest_length: 1, bulge: 1, volume: 'VOLUME_XZX', keep_axis: 'PLANE_X' }, [{ bone: 'root' }], { influence: 0.5 })] },
    ],
  });
  const pose = rig.evaluate(1, null, translation(0.1, 0, 0), (node) => targets[node]);
  console.log(solver, digest(pose));
  rig.free();
}
const object = kernels.object({ layouts, constraints: [constraint('CHILD_OF', 'ChildOfConstraint', { use_location_x: true, use_location_y: true, use_location_z: true, use_rotation_x: true,
  use_rotation_y: true, use_rotation_z: true, use_scale_x: true, use_scale_y: true, use_scale_z: true, inverse_matrix: translation(0, 0, -1) }, [{ node: 'goal' }]),
  constraint('TRACK_TO', 'TrackToConstraint', { track_axis: 'TRACK_NEGATIVE_Z', up_axis: 'UP_Y' }, [{ node: 'look' }])] });
console.log('object', digest(object.evaluate(1, translation(0, 2, 0), (node) => targets[node])));
object.free();
