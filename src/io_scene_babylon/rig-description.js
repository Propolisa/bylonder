// A character as the native rig runtime takes it (bylonder-native-rig/, the clean room's babylon-blender-rig, MIT): a
// description of schema `bylonder-rig` version 1 (its README, Rig description), read from Main by RNA name. It holds
// the scene's Simplify, the armature with its bones, pose and constraints, the meshes it deforms (their geometry,
// vertex groups, shape keys and modifiers), every object those name (targets, lattices, parents), their drivers and the
// actions they play.
import { blockData, positions } from '../runtimes/key-blocks.js';
import { actionFCurves } from './ir-export.js';
import { contextStruct, pointerOf } from '../python/bpy_rna.js';
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
// An IDProperty in the module's memory (wasm32): its name at 12, a group's first child at 84 and each child's next at 0,
// its UI data at 112; there an int's hard range at 20 and 24, a float's or double's as doubles at 32 and 40
// (IDPropertyUIDataInt, IDPropertyUIDataFloat), as read from the module.
const IDP = { name: 12, type: 8, first: 84, ui: 112 }, IDP_INT = 1, IDP_FLOAT = 2, IDP_DOUBLE = 8, IDP_GROUP = 6;
const RANGES = { [IDP_INT]: (v, ui) => [v.getInt32(ui + 20, true), v.getInt32(ui + 24, true)],
  [IDP_FLOAT]: (v, ui) => [v.getFloat64(ui + 32, true), v.getFloat64(ui + 40, true)], [IDP_DOUBLE]: (v, ui) => [v.getFloat64(ui + 32, true), v.getFloat64(ui + 40, true)] };
const nameAt = (v, at) => { let s = ''; for (let i = 0; i < 64; i++) { const c = v.getUint8(at + i); if (!c) break; s += String.fromCharCode(c); } return s; };
// Where in a struct of each type its custom properties' group is: found once, by the struct's first key.
const groupOffsets = new Map();
function propertyGroup(struct, view) {
  const [type, , at] = pointerOf(struct), first = struct.keys()[0], size = view.byteLength;
  const isGroup = (p) => p > 0 && p < size - 128 && view.getUint8(p + IDP.type) === IDP_GROUP && (() => { const c = view.getUint32(p + IDP.first, true); return c > 0 && c < size - 128 && nameAt(view, c + IDP.name) === first; })();
  if (!groupOffsets.has(type)) for (let o = 0; o < 1024; o += 4) if (isGroup(view.getUint32(at + o, true))) { groupOffsets.set(type, o); break; }
  const group = groupOffsets.has(type) ? view.getUint32(at + groupOffsets.get(type), true) : 0;
  return isGroup(group) ? group : 0;
}
// A struct's custom properties' hard limits (Blender's id_properties_ui(name).as_dict() min and max), which writes by
// animation and drivers are clamped to: by name, those of numbers with UI data.
export function limits(struct) {
  if (!struct.keys?.().length) return {};
  const view = new DataView(blenderModule.exports.memory.buffer), group = propertyGroup(struct, view), out = {};
  for (let c = group && view.getUint32(group + IDP.first, true); c; c = view.getUint32(c, true)) {
    const range = RANGES[view.getUint8(c + IDP.type)], ui = view.getUint32(c + IDP.ui, true);
    if (range && ui) { const [min, max] = range(view, ui); out[nameAt(view, c + IDP.name)] = { min, max }; }
  }
  return out;
}
const withLimits = (struct) => { const ui = limits(struct); return Object.keys(ui).length ? { properties_ui: ui } : {}; };
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
const poseBone = (pb) => ({ name: pb.name, ...transform(pb), ...pick(pb, POSE), constraints: [...pb.constraints].map(constraint), properties: numbers(pb), ...withLimits(pb) });

// A mesh's geometry (its edges in Blender's order, which subdivision follows), vertex groups and shape keys, named as
// their Key, which drivers of its blocks name (`mesh`: the Mesh Main holds, as main-sync gives it).
function meshData(ob, mesh) {
  const count = mesh.verts_num, offsets = mesh.face_offsets, corners = mesh.corner_verts, co = positions(ob.data);
  const vertices = Array.from({ length: count }, (_, i) => [co[i * 3], co[i * 3 + 1], co[i * 3 + 2]]);
  const faces = Array.from({ length: mesh.faces_num }, (_, f) => Array.from(corners.subarray(offsets[f], offsets[f + 1])));
  const groups = [...ob.vertex_groups].map((g) => ({ name: g.name, weights: new Array(count).fill(0) }));
  [...ob.data.vertices].forEach((v, i) => { for (const { group, weight } of v.groups) if (groups[group]) groups[group].weights[i] = weight; });
  const preservesVolume = [...ob.modifiers].some((m) => m.type === 'ARMATURE' && m.use_deform_preserve_volume), key = ob.data.shape_keys;
  const edges = Array.from({ length: mesh.edges_num }, (_, e) => [mesh.edges[e * 2], mesh.edges[e * 2 + 1]]);
  return { vertices, edges, faces, vertex_groups: groups, ...(preservesVolume && { vertex_group_order: groupOrder(ob.data) }), ...(key && { shape_keys: { name: key.name, use_relative: key.use_relative, eval_time: key.eval_time,
    key_blocks: [...key.key_blocks].map((kb) => ({ name: kb.name, co: Array.from({ length: count }, (_, i) => Array.from(blockData(kb, count).subarray(i * 3, i * 3 + 3))),
      value: kb.value, slider_min: kb.slider_min, slider_max: kb.slider_max, mute: kb.mute, relative_key: kb.relative_key.name, vertex_group: kb.vertex_group,
      interpolation: kb.interpolation })) } }) };
}

// Each vertex's group indices in its weight list's order, which Preserve Volume's blend follows: `indices` from
// `offsets[v]` to `offsets[v + 1]`.
function groupOrder(mesh) {
  const lists = [...mesh.vertices].map((v) => [...v.groups].map((g) => g.group));
  return { offsets: Int32Array.from([0, ...lists.map(((n) => (list) => (n += list.length))(0))]), indices: Int32Array.from(lists.flat()) };
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
// SurfaceDeformModifierData's verts and bind_verts_num, by its RNA's falloff: verts, then a pointer, then falloff; the
// number of vertices bound four fields after falloff. Each SDefVert: its bindings, their number, its vertex (12
// bytes); each SDefBind: its vertex indices, their number, its mode, its weights, its normal distance, its influence
// (24 bytes).
const FALLOFF = dna.SurfaceDeformModifier.properties.falloff.offset;
// A Surface Deform modifier's binding (Blender's Bind), as Blender stores it, which RNA does not expose: per bound
// vertex its bindings (`vertex_offsets`), and per binding its mode, influence, distance along the normal and four
// target vertices with their weights; `matrix`, the target's space to the mesh's at the bind (column-major, after the
// counts and flags).
function surfaceBind(m) {
  if (m.type !== 'SURFACE_DEFORM' || !m.is_bound) return null;
  const view = new DataView(blenderModule.exports.memory.buffer), at = pointerOf(m)[2];
  const verts = view.getUint32(at + FALLOFF - 8, true), count = view.getUint32(at + FALLOFF + 8, true);
  if (!verts) return null;
  const offsets = [0], mode = [], influence = [], distance = [], indices = [], weights = [], vertex = [];
  for (let i = 0; i < count; i++) {
    const v = verts + i * 12, binds = view.getUint32(v, true), n = view.getUint32(v + 4, true);
    vertex.push(view.getUint32(v + 8, true));
    for (let k = 0; k < n; k++) {
      const b = binds + k * 24, inds = view.getUint32(b, true), corners = view.getUint32(b + 4, true), w = view.getUint32(b + 12, true);
      mode.push(view.getInt32(b + 8, true));
      distance.push(view.getFloat32(b + 16, true));
      influence.push(view.getFloat32(b + 20, true));
      for (let j = 0; j < 4; j++) { indices.push(j < corners ? view.getUint32(inds + j * 4, true) : -1); weights.push(j < corners ? view.getFloat32(w + j * 4, true) : 0); }
    }
    offsets.push(mode.length);
  }
  return { vertex: Int32Array.from(vertex), vertex_offsets: Int32Array.from(offsets), mode: Int32Array.from(mode), influence: Float32Array.from(influence),
    normal_distance: Float32Array.from(distance), indices: Int32Array.from(indices), weights: Float32Array.from(weights),
    matrix: Float32Array.from({ length: 16 }, (_, k) => view.getFloat32(at + FALLOFF + 24 + k * 4, true)) };
}
const modifier = (m) => { const coords = bindCoords(m), bind = surfaceBind(m); return { ...rna(m), ...(coords && { bind_coords: coords }), ...(bind && { bind }) }; };

// A lattice's points and, as a mesh's, its object's vertex groups (each point's weight), which its Hooks and its own
// vertex group read.
const latticeData = (ob) => {
  const lt = ob.data, points = [...lt.points], groups = [...ob.vertex_groups].map((g) => ({ name: g.name, weights: new Array(points.length).fill(0) }));
  points.forEach((p, i) => { for (const { group, weight } of p.groups) if (groups[group]) groups[group].weights[i] = weight; });
  return { points_u: lt.points_u, points_v: lt.points_v, points_w: lt.points_w, interpolation_type_u: lt.interpolation_type_u,
    interpolation_type_v: lt.interpolation_type_v, interpolation_type_w: lt.interpolation_type_w, vertex_group: lt.vertex_group,
    points: points.map((p) => ({ co: [...p.co], co_deform: [...p.co_deform] })), vertex_groups: groups };
};

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

// The objects a character's armature and meshes name (parents, constraint and modifier targets, Surface Deform's
// meshes), the armature first.
function named(arm, meshes) {
  const all = new Map(), visit = (ob) => {
    if (!ob || all.has(ob.name)) return;
    all.set(ob.name, ob);
    visit(ob.parent);
    for (const c of [...ob.constraints, ...(ob.pose ? [...ob.pose.bones].flatMap((pb) => [...pb.constraints]) : [])]) for (const k of ['target', 'pole_target']) visit(c[k]);
    for (const m of ob.modifiers ?? []) { visit(m.object); visit(m.target); }
  };
  [arm, ...meshes].forEach(visit);
  return [...all.values()];
}

// Scene > Simplify's viewport Max Subdivision, which caps Subdivision and Multires levels; null with Simplify off.
const simplify = ({ render }) => (render.use_simplify ? { enabled: true, subdivision: render.simplify_subdivision } : null);

// The description of an armature (RNA's Object) and the mesh objects it deforms; `meshOf(ob)` gives a mesh object's
// Mesh as main-sync reads it; `keyed`, mesh objects whose shape keys' drivers the runtime runs (their keys' values
// published to the page), described by their keys' names alone.
export function rigDescription(arm, meshes, meshOf, keyed = []) {
  const objects = named(arm, [...meshes, ...keyed]), deformed = new Set(meshes.map((ob) => ob.name)), actions = new Map(), drivers = [];
  const use = (act) => act && !actions.has(act.name) && actions.set(act.name, action(act));
  const description = objects.map((ob) => {
    const ad = ob.animation_data;
    use(ad?.action);
    [...(ad?.nla_tracks ?? [])].forEach((t) => [...t.strips].forEach((s) => use(s.action)));
    drivers.push(...[...(ad?.drivers ?? [])].map(driver(ob, 'OBJECT')));
    const key = ob.type === 'MESH' ? ob.data.shape_keys : null;
    if (key?.animation_data) drivers.push(...[...key.animation_data.drivers].map(driver(key, 'KEY')));
    const out = { name: ob.name, type: ob.type, parent: ob.parent?.name ?? null, parent_type: ob.parent_type, parent_bone: ob.parent_bone || null,
      matrix_parent_inverse: rows(ob.matrix_parent_inverse), ...transform(ob), constraints: [...ob.constraints].map(constraint), properties: numbers(ob), ...withLimits(ob),
      animation_data: animationData(ad) };
    if (ob.type === 'ARMATURE') {
      for (const pb of ob.pose.bones) for (const c of pb.constraints) if (c.type === 'ACTION') use(c.action);
      return { ...out, data: { name: ob.data.name, bones: [...ob.data.bones].map(bone) }, pose: { ik_solver: ob.pose.ik_solver, bones: [...ob.pose.bones].map(poseBone) } };
    }
    if (ob.type === 'LATTICE') return { ...out, data: latticeData(ob), modifiers: [...ob.modifiers].map(modifier) };
    if (ob.type === 'MESH' && deformed.has(ob.name)) return { ...out, data: meshData(ob, meshOf(ob)), modifiers: [...ob.modifiers].map(modifier) };
    // A mesh only its shape keys' drivers run for: the Key's and its blocks' names and values, no geometry.
    if (ob.type === 'MESH' && key) return { ...out, data: { shape_keys: { name: key.name, key_blocks: [...key.key_blocks].map((kb) => ({ name: kb.name, value: kb.value, slider_min: kb.slider_min,
      slider_max: kb.slider_max, mute: kb.mute })) } } };
    return out;
  });
  return { schema: 'bylonder-rig', version: 1, scene: { simplify: simplify(contextStruct().scene) }, objects: description, drivers, actions: [...actions.values()] };
}

// The description with its bulk as typed arrays: a mesh's vertices and faces, its vertex groups' weights and order, its shape
// keys' offsets from the basis (each where non-zero), the vertices it draws, its Corrective Smooth and Surface Deform binds, and F-Curves'
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
      ...(data.vertex_group_order && { vertex_group_order: { offsets: buffer(data.vertex_group_order.offsets), indices: buffer(data.vertex_group_order.indices) } }),
      faces: { offsets: buffer(Int32Array.from([0, ...data.faces.map(((n) => (f) => (n += f.length))(0))])), indices: buffer(Int32Array.from(data.faces.flat())) },
      vertex_groups: data.vertex_groups.map(({ name, weights }) => ({ name, count: weights.length, ...sparse(weights) })),
      ...(data.shape_keys && { shape_keys: { ...data.shape_keys, key_blocks: data.shape_keys.key_blocks.map((kb, i) => ({ ...kb, count: kb.co.length,
        co: i ? sparse(kb.co, basis) : buffer(Float32Array.from(kb.co.flat())) })) } }) };
  };
  const curve = ({ keyframe_points: keys, ...fc }) => ({ ...fc, keys: buffer(Float32Array.from(keys.flatMap((k) => [...k.co, ...k.handle_left, ...k.handle_right, k.back, k.amplitude, k.period]))),
    enums: keys.map((k) => [k.interpolation, k.easing, k.handle_left_type, k.handle_right_type]) });
  const modifiers = (list) => list?.map((m) => ({ ...m, ...(m.bind_coords && { bind_coords: buffer(m.bind_coords) }),
    ...(m.bind && { bind: Object.fromEntries(Object.entries(m.bind).map(([key, array]) => [key, buffer(array)])) }) }));
  const packed = { ...description, objects: description.objects.map((ob) => (ob.type === 'MESH' && ob.data?.vertices ? { ...ob, data: mesh(ob.data), modifiers: modifiers(ob.modifiers) } : ob)),
    drivers: description.drivers.map(curve), actions: description.actions.map((a) => ({ ...a, fcurves: a.fcurves.map(curve) })) };
  return { packed, arrays };
}
