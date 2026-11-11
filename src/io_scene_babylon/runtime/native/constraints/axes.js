// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Shared settings of the copy constraints: the used axes and their inversion.
export const AXIS_DEFAULTS = { use_x: true, use_y: true, use_z: true, invert_x: false, invert_y: false, invert_z: false };
export const used = (s) => [s.use_x, s.use_y, s.use_z];
export const sign = (s) => [s.invert_x ? -1 : 1, s.invert_y ? -1 : 1, s.invert_z ? -1 : 1];
