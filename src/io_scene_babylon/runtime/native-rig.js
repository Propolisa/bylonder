// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `native-rig` implementation of `rig:CHARACTER` entities: a character run by the clean room's rig runtime
// (bylonder-native-rig/, babylon-blender-rig), from its `bylonder-rig` description, whose bulk the export put in
// scene.bin (rig-description.js packDescription).

/** @param {ArrayLike<number>} flat @param {number} size @returns {number[][]} */
const chunks = (flat, size) => Array.from({ length: flat.length / size }, (_, i) => Array.from({ length: size }, (_, k) => flat[i * size + k]));

/**
 * A description as the runtime reads it, its typed arrays (the scheduler's resolved buffers) back into lists.
 * @param {any} description
 */
export function unpackDescription(description) {
  /** @param {{ indices: Int32Array, values: Float32Array }} sparse @param {number} count @param {number[][] | null} basis */
  const dense = ({ indices, values }, count, basis = null) => {
    const size = basis ? 3 : 1, out = basis ? basis.map((v) => [...v]) : new Array(count).fill(0);
    indices.forEach((i, j) => { if (basis) for (let k = 0; k < 3; k++) out[i][k] += values[j * 3 + k]; else out[i] = values[j * size]; });
    return out;
  };
  /** @param {any} data */
  const mesh = (data) => {
    const { offsets, indices } = data.faces, basis = data.shape_keys && chunks(data.shape_keys.key_blocks[0].co, 3);
    return { ...data, vertices: chunks(data.vertices, 3), edges: chunks(data.edges, 2),
      faces: Array.from({ length: offsets.length - 1 }, (_, f) => Array.from(indices.subarray(offsets[f], offsets[f + 1]))),
      vertex_groups: data.vertex_groups.map((/** @type {any} */ g) => ({ name: g.name, weights: dense(g, g.count) })),
      ...(data.shape_keys && { shape_keys: { ...data.shape_keys, key_blocks: data.shape_keys.key_blocks.map((/** @type {any} */ kb, /** @type {number} */ i) => ({ ...kb,
        co: i ? dense(kb.co, kb.count, basis) : basis })) } }) };
  };
  /** @param {any} fc */
  const curve = ({ keys, enums, ...fc }) => ({ ...fc, keyframe_points: enums.map((/** @type {string[]} */ [interpolation, easing, handle_left_type, handle_right_type], /** @type {number} */ i) => ({
    co: [keys[i * 9], keys[i * 9 + 1]], handle_left: [keys[i * 9 + 2], keys[i * 9 + 3]], handle_right: [keys[i * 9 + 4], keys[i * 9 + 5]],
    back: keys[i * 9 + 6], amplitude: keys[i * 9 + 7], period: keys[i * 9 + 8], interpolation, easing, handle_left_type, handle_right_type })) });
  return { ...description, objects: description.objects.map((/** @type {any} */ ob) => (ob.type === 'MESH' && ob.data?.faces ? { ...ob, data: mesh(ob.data) } : ob)),
    drivers: description.drivers.map(curve), actions: description.actions.map((/** @type {any} */ a) => ({ ...a, fcurves: a.fcurves.map(curve) })) };
}
