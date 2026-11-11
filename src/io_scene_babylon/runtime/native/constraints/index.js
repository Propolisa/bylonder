// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import copyTransforms from './copy_transforms.js';
import stretchTo from './stretch_to.js';
import copyLocation from './copy_location.js';
import copyRotation from './copy_rotation.js';
import copyScale from './copy_scale.js';
import dampedTrack from './damped_track.js';
import ik from './ik.js';
import limitRotation from './limit_rotation.js';
import trackTo from './track_to.js';
import limitDistance from './limit_distance.js';
import armature from './armature.js';
import childOf from './child_of.js';
import splineIK from './spline_ik.js';
import action from './action.js';
import shrinkwrap from './shrinkwrap.js';
import { limitLocation, limitScale } from './limit_location.js';
import maintainVolume from './maintain_volume.js';
import lockedTrack from './locked_track.js';
import floor from './floor.js';
import pivot from './pivot.js';
import transform from './transform.js';
import { followPath, clampTo } from './follow_path.js';

// One module per type, each { type, targets, defaults, evaluate(owner, target, settings, spaces) }.
export const constraintTypes = Object.fromEntries(
  [copyTransforms, stretchTo, copyLocation, copyRotation, copyScale, dampedTrack, ik, limitRotation, trackTo, limitDistance, armature, childOf, splineIK, action, shrinkwrap, limitLocation, limitScale, maintainVolume, lockedTrack, floor, pivot, transform, followPath, clampTo].map((t) => [t.type, t]),
);
