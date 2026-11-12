// A character as the native rig runtime takes it (bylonder-native-rig/, the clean room's babylon-blender-rig, MIT): a
// description of schema `bylonder-rig` version 1 (its README, Rig description), read from Main by RNA name. It holds
// the armature with its bones, pose and constraints, the meshes it deforms (their geometry, vertex groups, shape keys
// and modifiers), every object those name (targets, lattices, parents), their drivers and the actions they play.
import { blockData, positions } from '../runtimes/key-blocks.js';
import { actionFCurves } from './ir-export.js';
import { pointerOf } from '../python/bpy_rna.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import dna from '../makesrna/dna-modifiers.json' with { type: 'json' };

// A matrix (RNA's, column-major, flat or by column) as rows.
const rows = (m) => { const flat = typeof m[0] === 'object' ? [...m].flatMap((c) => [...c]) : [...m]; return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => flat[c * 4 + r])); };
const SKIP = new Set(['rna_type', 'is_valid', 'active', 'show_expanded', 'is_override_data_editable', 'error_location', 'error_rotation']);

// A struct's settings by RNA name: IDs and structs by name, flags as sorted lists, arrays and matrices as lists.
function rna(struct) {
  const out = {};
  for (const p of struct.bl_rna.properties) {
    if (SKIP.has(p.identifier) || p.type === 'COLLECTION') continue;
    let v;
    try { v = struct[p.identifier]; } catch { continue; }
    if (p.type === 'POINTER') out[p.identifier] = v?.name ?? null;
    else if (v instanceof Set) out[p.identifier] = [...v].sort();
    else if (v !== null && typeof v === 'object') out[p.identifier] = typeof v[0] === 'object' || p.identifier.startsWith('matrix') ? rows(v) : [...v];
    else out[p.identifier] = v;
  }
  return out;
}
// A struct's custom properties that are numbers, which drivers read.
const numbers = (struct) => Object.fromEntries([...(struct.keys?.() ?? [])].map((k) => [k, struct.get(k)]).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => [k, Number(v)]));
const transform = (x) => ({ location: [...x.location], rotation_mode: x.rotation_mode, rotation_quaternion: [...x.rotation_quaternion],
  rotation_euler: [...x.rotation_euler], rotation_axis_angle: [...x.rotation_axis_angle], scale: [...x.scale] });
const constraint = (c) => ({ ...rna(c), ...(c.type === 'ARMATURE' && { targets: [...c.targets].map((t) => ({ target: t.target?.name ?? null, subtarget: t.subtarget, weight: t.weight })) }) });

const BONE = ['use_connect', 'use_inherit_rotation', 'inherit_scale', 'use_local_location', 'use_deform', 'bbone_segments', 'bbone_x', 'bbone_z',
  'bbone_curveinx', 'bbone_curveinz', 'bbone_curveoutx', 'bbone_curveoutz', 'bbone_rollin', 'bbone_rollout', 'use_endroll_as_inroll', 'bbone_easein',
  'bbone_easeout', 'bbone_scalein', 'bbone_scaleout', 'use_scale_easing', 'bbone_mapping_mode', 'bbone_handle_type_start', 'bbone_handle_type_end',
  'bbone_handle_use_scale_start', 'bbone_handle_use_scale_end', 'bbone_handle_use_ease_start', 'bbone_handle_use_ease_end',
  'envelope_distance', 'envelope_weight', 'head_radius', 'tail_radius', 'use_envelope_multiply'];
const POSE = ['lock_ik_x', 'lock_ik_y', 'lock_ik_z', 'ik_stiffness_x', 'ik_stiffness_y', 'ik_stiffness_z', 'ik_stretch', 'use_ik_limit_x', 'use_ik_limit_y',
  'use_ik_limit_z', 'ik_min_x', 'ik_max_x', 'ik_min_y', 'ik_max_y', 'ik_min_z', 'ik_max_z', 'bbone_curveinx', 'bbone_curveinz', 'bbone_curveoutx',
  'bbone_curveoutz', 'bbone_rollin', 'bbone_rollout', 'bbone_easein', 'bbone_easeout', 'bbone_scalein', 'bbone_scaleout'];
const pick = (struct, keys) => Object.fromEntries(keys.filter((k) => struct[k] !== undefined).map((k) => [k, typeof struct[k] === 'object' ? [...struct[k]] : struct[k]]));

const bone = (b) => ({ name: b.name, parent: b.parent?.name ?? null, matrix_local: rows(b.matrix_local), length: b.length, head_local: [...b.head_local],
  tail_local: [...b.tail_local], ...pick(b, BONE), bbone_custom_handle_start: b.bbone_custom_handle_start?.name ?? null, bbone_custom_handle_end: b.bbone_custom_handle_end?.name ?? null });
const poseBone = (pb) => ({ name: pb.name, ...transform(pb), ...pick(pb, POSE), constraints: [...pb.constraints].map(constraint), properties: numbers(pb) });

// A mesh's geometry (its edges in Blender's order, which subdivision follows), vertex groups and shape keys (`mesh`: the Mesh Main holds, as main-sync gives it).
function meshData(ob, mesh) {
  const count = mesh.verts_num, offsets = mesh.face_offsets, corners = mesh.corner_verts, co = positions(ob.data);
  const vertices = Array.from({ length: count }, (_, i) => [co[i * 3], co[i * 3 + 1], co[i * 3 + 2]]);
  const faces = Array.from({ length: mesh.faces_num }, (_, f) => Array.from(corners.subarray(offsets[f], offsets[f + 1])));
  const groups = [...ob.vertex_groups].map((g) => ({ name: g.name, weights: new Array(count).fill(0) }));
  [...ob.data.vertices].forEach((v, i) => { for (const { group, weight } of v.groups) if (groups[group]) groups[group].weights[i] = weight; });
  const key = ob.data.shape_keys;
  const edges = Array.from({ length: mesh.edges_num }, (_, e) => [mesh.edges[e * 2], mesh.edges[e * 2 + 1]]);
  return { vertices, edges, faces, vertex_groups: groups, ...(key && { shape_keys: { use_relative: key.use_relative, eval_time: key.eval_time,
    key_blocks: [...key.key_blocks].map((kb) => ({ name: kb.name, co: Array.from({ length: count }, (_, i) => Array.from(blockData(kb, count).subarray(i * 3, i * 3 + 3))),
      value: kb.value, slider_min: kb.slider_min, slider_max: kb.slider_max, mute: kb.mute, relative_key: kb.relative_key.name, vertex_group: kb.vertex_group,
      interpolation: kb.interpolation })) } }) };
}

// CorrectiveSmoothModifierData's bind_coords, their sharing info and bind_coords_num, before lambda (RNA's factor).
const LAMBDA = dna.CorrectiveSmoothModifier.properties.factor.offset;
// A Corrective Smooth modifier's positions at its bind (Blender's Bind), which a rest source of BIND smooths toward;
// RNA does not expose them, so they are read from the ModifierData.
function bindCoords(m) {
  if (m.type !== 'CORRECTIVE_SMOOTH' || m.rest_source !== 'BIND' || !m.is_bind) return null;
  const memory = blenderModule.exports.memory.buffer, view = new DataView(memory), at = pointerOf(m)[2];
  const coords = view.getUint32(at + LAMBDA - 12, true), count = view.getUint32(at + LAMBDA - 4, true);
  return coords ? new Float32Array(memory, coords >>> 0, count * 3).slice() : null;
}
const modifier = (m) => { const bind = bindCoords(m); return { ...rna(m), ...(bind && { bind_coords: bind }) }; };

const latticeData = (lt) => ({ points_u: lt.points_u, points_v: lt.points_v, points_w: lt.points_w, interpolation_type_u: lt.interpolation_type_u,
  interpolation_type_v: lt.interpolation_type_v, interpolation_type_w: lt.interpolation_type_w, vertex_group: lt.vertex_group,
  points: [...lt.points].map((p) => ({ co: [...p.co], co_deform: [...p.co_deform] })) });

// An F-Curve as the runtime reads it (README, FCurve).
const fcurve = (fc) => ({ data_path: fc.data_path, array_index: fc.array_index, extrapolation: fc.extrapolation, auto_smoothing: fc.auto_smoothing,
  keyframe_points: [...fc.keyframe_points].map((k) => ({ co: [...k.co], interpolation: k.interpolation, easing: k.easing, handle_left: [...k.handle_left],
    handle_right: [...k.handle_right], handle_left_type: k.handle_left_type, handle_right_type: k.handle_right_type, back: k.back, amplitude: k.amplitude, period: k.period })),
  modifiers: [...fc.modifiers].map(rna) });
const driver = (id, idType) => (fc) => ({ ...fcurve(fc), id: id.name, id_type: idType, type: fc.driver.type, expression: fc.driver.expression, use_self: fc.driver.use_self,
  variables: [...fc.driver.variables].map((v) => ({ name: v.name, type: v.type, targets: [...v.targets].slice(0, ['LOC_DIFF', 'ROTATION_DIFF'].includes(v.type) ? 2 : 1)
    .map((t) => ({ id: t.id?.name ?? null, id_type: t.id_type, data_path: t.data_path, bone_target: t.bone_target, transform_type: t.transform_type,
      transform_space: t.transform_space, rotation_mode: t.rotation_mode })) })) });
// An action's slots and the F-Curves of each, by slot name.
const action = (act) => ({ name: act.name, slots: [...act.slots].map((s) => ({ name: s.identifier, id_type: s.target_id_type })),
  fcurves: [...act.layers].flatMap((l) => [...l.strips]).flatMap((s) => [...s.channelbags]).flatMap((bag) => [...bag.fcurves].map((fc) => ({ ...fcurve(fc), slot: bag.slot?.identifier }))) });
const animationData = (ad) => ad && { action: ad.action?.name ?? null, action_slot: ad.action_slot?.identifier ?? null, action_blend_type: ad.action_blend_type,
  action_influence: ad.action_influence, nla_tracks: [...ad.nla_tracks].map((t) => ({ mute: t.mute, strips: [...t.strips].map((s) => ({ action: s.action?.name ?? null,
    action_slot: s.action_slot?.identifier ?? null, ...pick(s, ['frame_start', 'frame_end', 'action_frame_start', 'action_frame_end', 'scale', 'repeat', 'blend_type',
      'extrapolation', 'influence', 'use_animated_influence', 'blend_in', 'blend_out', 'mute']) })) })) };

// The objects a character's armature and meshes name (parents, constraint and modifier targets), the armature first.
function named(arm, meshes) {
  const all = new Map(), visit = (ob) => {
    if (!ob || all.has(ob.name)) return;
    all.set(ob.name, ob);
    visit(ob.parent);
    for (const c of [...ob.constraints, ...(ob.pose ? [...ob.pose.bones].flatMap((pb) => [...pb.constraints]) : [])]) for (const k of ['target', 'pole_target']) visit(c[k]);
    for (const m of ob.modifiers ?? []) visit(m.object);
  };
  [arm, ...meshes].forEach(visit);
  return [...all.values()];
}

// The description of an armature (RNA's Object) and the mesh objects it deforms; `meshOf(ob)` gives a mesh object's
// Mesh as main-sync reads it.
export function rigDescription(arm, meshes, meshOf) {
  const objects = named(arm, meshes), deformed = new Set(meshes.map((ob) => ob.name)), actions = new Map(), drivers = [];
  const use = (act) => act && !actions.has(act.name) && actions.set(act.name, action(act));
  const description = objects.map((ob) => {
    const ad = ob.animation_data;
    use(ad?.action);
    [...(ad?.nla_tracks ?? [])].forEach((t) => [...t.strips].forEach((s) => use(s.action)));
    drivers.push(...[...(ad?.drivers ?? [])].map(driver(ob, 'OBJECT')));
    const key = ob.type === 'MESH' ? ob.data.shape_keys : null;
    if (key?.animation_data) drivers.push(...[...key.animation_data.drivers].map(driver(key, 'KEY')));
    const out = { name: ob.name, type: ob.type, parent: ob.parent?.name ?? null, parent_type: ob.parent_type, parent_bone: ob.parent_bone || null,
      matrix_parent_inverse: rows(ob.matrix_parent_inverse), ...transform(ob), constraints: [...ob.constraints].map(constraint), properties: numbers(ob),
      animation_data: animationData(ad) };
    if (ob.type === 'ARMATURE') {
      for (const pb of ob.pose.bones) for (const c of pb.constraints) if (c.type === 'ACTION') use(c.action);
      return { ...out, data: { name: ob.data.name, bones: [...ob.data.bones].map(bone) }, pose: { ik_solver: ob.pose.ik_solver, bones: [...ob.pose.bones].map(poseBone) } };
    }
    if (ob.type === 'LATTICE') return { ...out, data: latticeData(ob.data), modifiers: [...ob.modifiers].map(rna) };
    if (ob.type === 'MESH' && deformed.has(ob.name)) return { ...out, data: meshData(ob, meshOf(ob)), modifiers: [...ob.modifiers].map(modifier) };
    return out;
  });
  return { schema: 'bylonder-rig', version: 1, objects: description, drivers, actions: [...actions.values()] };
}

// The description with its bulk as typed arrays: a mesh's vertices and faces, its vertex groups' weights and its shape
// keys' offsets from the basis (each where non-zero), the vertices it draws, its Corrective Smooth binds, and F-Curves'
// keys, as `{ array }` indices into `arrays`, which the page reads back (runtime/native-rig.js unpackDescription).
export function packDescription(description) {
  const arrays = [], buffer = (array) => ({ array: arrays.push(array) - 1 });
  const sparse = (values, basis = null) => {
    const indices = [], out = [];
    values.forEach((v, i) => { const d = basis ? v.map((x, k) => x - basis[i][k]) : [v]; if (d.some((x) => x !== 0)) { indices.push(i); out.push(...d); } });
    return { indices: buffer(Int32Array.from(indices)), values: buffer(Float32Array.from(out)) };
  };
  const mesh = (data) => {
    const basis = data.shape_keys?.key_blocks[0]?.co;
    return { ...data, vertices: buffer(Float32Array.from(data.vertices.flat())), edges: buffer(Int32Array.from(data.edges.flat())),
      ...(data.draw_vertices && { draw_vertices: buffer(data.draw_vertices) }),
      faces: { offsets: buffer(Int32Array.from([0, ...data.faces.map(((n) => (f) => (n += f.length))(0))])), indices: buffer(Int32Array.from(data.faces.flat())) },
      vertex_groups: data.vertex_groups.map(({ name, weights }) => ({ name, count: weights.length, ...sparse(weights) })),
      ...(data.shape_keys && { shape_keys: { ...data.shape_keys, key_blocks: data.shape_keys.key_blocks.map((kb, i) => ({ ...kb, count: kb.co.length,
        co: i ? sparse(kb.co, basis) : buffer(Float32Array.from(kb.co.flat())) })) } }) };
  };
  const curve = ({ keyframe_points: keys, ...fc }) => ({ ...fc, keys: buffer(Float32Array.from(keys.flatMap((k) => [...k.co, ...k.handle_left, ...k.handle_right, k.back, k.amplitude, k.period]))),
    enums: keys.map((k) => [k.interpolation, k.easing, k.handle_left_type, k.handle_right_type]) });
  const modifiers = (list) => list?.map((m) => (m.bind_coords ? { ...m, bind_coords: buffer(m.bind_coords) } : m));
  const packed = { ...description, objects: description.objects.map((ob) => (ob.type === 'MESH' && ob.data?.vertices ? { ...ob, data: mesh(ob.data), modifiers: modifiers(ob.modifiers) } : ob)),
    drivers: description.drivers.map(curve), actions: description.actions.map((a) => ({ ...a, fcurves: a.fcurves.map(curve) })) };
  return { packed, arrays };
}
