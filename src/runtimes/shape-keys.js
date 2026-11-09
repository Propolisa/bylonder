// Shape keys on Babylon (docs/runtimes.md, Babylon (mapped)): a mesh's relative shape keys as a Babylon
// MorphTargetManager on the Mesh Main holds, so a key's value (animated or dragged) changes only a target's influence,
// blended on the GPU. Blender still owns the keys (their values, Edit Mode on a key, every operator); Babylon blends
// them as key.cc's key_evaluate_relative_float3 does: Basis plus each unmuted key's value times its offset from its
// relative key, scaled by its vertex group. Only the normals differ: Babylon blends the keys' own normals linearly where
// Blender recomputes them from the blended positions.
import { Animation, BoundingInfo, MorphTarget, MorphTargetManager, Vector3 } from '@babylonjs/core';
import { idStruct, pointerOf } from '../python/bpy_rna.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { modifierStack } from '../modifiers/stack.js';
import { mesh_batch_cache_corner_buffers, mesh_batch_cache_flat } from '../draw/mesh-batch-buffers.js';
import { registerRuntime, runtimeOf, APPROXIMATION, FALLBACK } from './runtimes.js';
import { exactAnimation } from '../io_scene_babylon/exact-keys.js';
import { actionFCurves } from '../io_scene_babylon/ir-export.js';

const address = (struct) => pointerOf(struct)?.[2] ?? 0;
// A key block's coordinates in the module's memory (KeyBlock.data, contiguous float[3] per vertex).
const blockData = (kb, count) => (count ? new Float32Array(blenderModule.exports.memory.buffer, pointerOf(kb.data[0])[2], count * 3) : new Float32Array(0));
const keyPath = (key, path) => `bpy.data.shape_keys["${key.name}"].${path}`;
const issue = (kind, setting, message) => ({ kind, setting, message });
const NORMALS = (key) => issue(APPROXIMATION, keyPath(key, 'key_blocks'), "normals blended from each key's own, not recomputed");
const EDITING = ['EDIT', 'SCULPT'];

// What of an object's shape keys Babylon cannot blend, so that its mesh evaluates as Blender. `entry`: the view's.
function fallbacks(view, entry, ob, key) {
  if (entry.overlay || EDITING.includes(ob.mode)) return [{ kind: FALLBACK, setting: null, message: `${ob.name}: being edited`, silent: true }];
  const out = [];
  if (!key.use_relative) out.push(issue(FALLBACK, keyPath(key, 'use_relative'), `${key.name}: absolute shape keys`));
  if (!view.drawsGeometry(entry)) out.push(issue(FALLBACK, `bpy.data.objects["${ob.name}"].data`, `${ob.name}: Babylon's own geometry`));
  const shown = [...ob.modifiers].find((m) => m.show_viewport);
  if (shown) out.push(issue(FALLBACK, `bpy.data.objects["${ob.name}"].modifiers["${shown.name}"].show_viewport`, `${ob.name}: ${shown.name} after the shape keys`));
  if (modifierStack(entry.node).some((m) => m.showViewport)) out.push(issue(FALLBACK, `bpy.data.objects["${ob.name}"].modifiers`, `${ob.name}: Bylonder's modifiers after the shape keys`));
  const active = ob.active_shape_key;
  if (ob.show_only_shape_key && active && !active.mute && active.relative_key.name !== key.reference_key.name) {
    out.push(issue(FALLBACK, `bpy.data.objects["${ob.name}"].show_only_shape_key`, `${ob.name}: pinned ${active.name} is relative to ${active.relative_key.name}, not ${key.reference_key.name}`));
  }
  return out;
}

// Each vertex's weight in a vertex group (key.cc get_weights_array), or null for none.
function groupWeights(ob, name, count) {
  const group = name ? ob.vertex_groups.get(name) : null;
  if (!group) return null;
  const weights = new Float32Array(count), index = group.index;
  Array.from(ob.data.vertices, (vertex, i) => { for (const g of vertex.groups) if (g.group === index) weights[i] = g.weight; });
  return weights;
}

// The keys Babylon blends (all but Basis, with Blender's vertex count), each as Basis plus its weighted offset from its
// relative key, in Babylon's corners, with its own normals; and their offsets' bounds, for the blended mesh's bounds.
function targetsOf(ob, key, mesh) {
  const count = mesh.verts_num, basis = blockData(key.reference_key, count), flat = mesh_batch_cache_flat(mesh), custom = !!mesh.corner_normals?.();
  return [...key.key_blocks].filter((kb) => kb.name !== key.reference_key.name && kb.data.length === count).map((kb) => {
    const data = blockData(kb, count), relative = blockData(kb.relative_key, count), weights = groupWeights(ob, kb.vertex_group, count);
    const shape = new Float32Array(count * 3), min = [0, 0, 0], max = [0, 0, 0];
    for (let i = 0; i < count * 3; i++) {
      const offset = (weights ? weights[Math.floor(i / 3)] : 1) * (data[i] - relative[i]);
      shape[i] = basis[i] + offset;
      min[i % 3] = Math.min(min[i % 3], offset);
      max[i % 3] = Math.max(max[i % 3], offset);
    }
    const buffers = mesh_batch_cache_corner_buffers(mesh, shape, custom ? { corner: kb.normals_split_get() }
      : { face: kb.normals_polygon_get(), vert: flat ? null : kb.normals_vertex_get() });
    return { name: kb.name, ...buffers, min: new Vector3(min[0], min[2], min[1]), max: new Vector3(max[0], max[2], max[1]) };
  });
}

// What the targets are made of besides the Mesh (whose changes, vertex weights included, tag its data): the keys'
// structure and their coordinates, Basis included, kept as copies to compare.
const structureOf = (key) => JSON.stringify([...key.key_blocks].map((kb) => [kb.name, kb.relative_key.name, kb.vertex_group, kb.data.length]));
const signatureOf = (key, count) => ({
  structure: structureOf(key),
  data: [...key.key_blocks].map((kb) => (kb.data.length === count ? blockData(kb, count).slice() : null)),
});
function unchanged(signature, key, count) {
  if (signature.structure !== structureOf(key)) return false;
  return [...key.key_blocks].every((kb, i) => {
    const kept = signature.data[i];
    if (!kept) return true;
    const data = blockData(kb, count);
    for (let j = 0; j < kept.length; j++) if (kept[j] !== data[j]) return false;
    return true;
  });
}

// Each target's influence now (key.cc BKE_key_evaluate_object_ex): its value, 0 muted; with the object's shape pinned,
// the active key's 1 and the others' 0 (a muted active key pins Basis).
function influences(ob, key, names) {
  const pinned = ob.show_only_shape_key ? ob.active_shape_key : null;
  return names.map((name) => {
    const kb = key.key_blocks.get(name);
    if (ob.show_only_shape_key) return pinned && !pinned.mute && pinned.name === name ? 1 : 0;
    return kb.mute ? 0 : kb.value;
  });
}

// A mesh object's keys as a MorphTargetManager on its node: the Mesh Main holds drawn, then its targets.
function morph(view, entry, ob, key) {
  const mesh = view.blender.mesh(entry.ob);
  const basis = blockData(key.reference_key, mesh.verts_num), positions = mesh.vert_positions;
  for (let i = 0; i < basis.length; i++) if (basis[i] !== positions[i]) return null;
  view.drawMesh(entry, mesh);
  const manager = new MorphTargetManager(view.scene), targets = targetsOf(ob, key, mesh);
  for (const target of targets) {
    const made = new MorphTarget(target.name, 0, view.scene);
    made.setPositions(target.positions);
    made.setNormals(target.normals);
    manager.addTarget(made);
  }
  entry.node.morphTargetManager = manager;
  const { minimum, maximum } = entry.node.getBoundingInfo();
  return { manager, targets, signature: signatureOf(key, mesh.verts_num), count: mesh.verts_num, bounds: [minimum.clone(), maximum.clone()] };
}
// Babylon's settings applied, influences set and bounds grown by each target's offsets at its influence.
function blend(entry, state, ob, key) {
  const settings = key.bylonder.babylon;
  state.manager.useTextureToStoreTargets = settings.use_texture_for_targets;
  state.manager.enableNormalMorphing = settings.use_normal_morphing;
  const values = influences(ob, key, state.targets.map((t) => t.name)), [min, max] = state.bounds.map((v) => v.clone());
  values.forEach((value, i) => {
    state.manager.getTarget(i).influence = value;
    const { min: a, max: b } = state.targets[i], low = value < 0 ? b : a, high = value < 0 ? a : b;
    min.addInPlace(low.scale(value));
    max.addInPlace(high.scale(value));
  });
  entry.node.setBoundingInfo(new BoundingInfo(min, max));
}
function unmorph(view, entry, state) {
  state.manager.dispose();
  if (!entry) return;
  entry.node.morphTargetManager = null;
  view.drawGeometry(entry);
}

// The view's morphed objects by Object address: { manager, targets, signature, count, bounds }.
const morphed = new Map();
// Objects morphed for an export only: the view keeps their basis drawn while the export evaluates other frames.
const exporting = new Set();
const issuesByKey = new Map();
let lastView = null;
const meshKey = (ob) => (ob.type === 'MESH' ? ob.data?.shape_keys ?? null : null);

// After Main was evaluated: each mesh object whose keys are on Babylon (mapped) and blend there gets its targets
// (made again when the keys' data or structure changed) and their influences now; the others evaluate as Blender.
function evaluate(view) {
  lastView = view;
  const keys = new Map(), live = new Set();
  issuesByKey.clear();
  for (const entry of view.entries()) {
    if (entry.type !== 'MESH') continue;
    const ob = idStruct(entry.ob), key = meshKey(ob);
    if (!key) continue;
    keys.set(address(key), key);
    if (runtimeOf(key) !== 'MAPPED') continue;
    const issues = fallbacks(view, entry, ob, key);
    issuesByKey.set(address(key), [...(issuesByKey.get(address(key)) ?? []), ...issues]);
    if (issues.length) continue;
    let state = morphed.get(entry.ob);
    // Blender tags the Mesh whenever its keys change (a value animated or dragged): the Mesh alone tagged is an edit of
    // it (weights, UVs); the keys' own data is compared.
    const [obTag, meshTag, keyTag] = [entry.ob, entry.data.ptr, address(key)].map((id) => view.updates.has(id));
    const rebuild = !state || (meshTag && !keyTag) || ((obTag || meshTag || keyTag) && !unchanged(state.signature, key, state.count));
    if (rebuild) {
      state?.manager.dispose();
      morphed.delete(entry.ob);
      state = morph(view, entry, ob, key);
      if (!state) {
        issuesByKey.get(address(key)).push(issue(FALLBACK, keyPath(key, 'reference_key'), `${ob.name}: the mesh's positions differ from ${key.reference_key.name}`));
        entry.node.morphTargetManager = null;
        view.drawGeometry(entry);
        continue;
      }
      morphed.set(entry.ob, state);
    }
    live.add(entry.ob);
    blend(entry, state, ob, key);
  }
  const byOb = new Map([...view.entries()].map((entry) => [entry.ob, entry]));
  for (const [ob, state] of morphed) if (!live.has(ob)) { morphed.delete(ob); unmorph(view, byOb.get(ob), state); }
  return [...keys.values()];
}

const issues = (key) => [...(issuesByKey.get(address(key)) ?? []).filter((i) => !i.silent), NORMALS(key)];

// Export: every mesh's keys as morph targets, those on Blender for the export's duration, with the influences' animation
// at each frame where the keys are animated.
function exportShapeKeys(world) {
  const view = lastView;
  if (!view || !world.mainSync) return { reports: [], animations: [], restore() {} };
  const temporary = [], mapped = [];
  for (const entry of view.entries()) {
    if (entry.type !== 'MESH') continue;
    const ob = idStruct(entry.ob), key = meshKey(ob);
    if (!key || fallbacks(view, entry, ob, key).length) continue;
    let state = morphed.get(entry.ob);
    if (!state) {
      state = morph(view, entry, ob, key);
      if (!state) continue;
      blend(entry, state, ob, key);
      temporary.push([entry, state]);
      exporting.add(entry.ob);
    }
    mapped.push({ entry, ob, key, state });
  }
  return {
    reports: mapped.map(({ key }) => ({ title: `${key.name}: exported`, issues: [NORMALS(key)] })),
    animations: influenceAnimations(world, mapped),
    restore() {
      exporting.clear();
      for (const [entry, state] of temporary) unmorph(view, entry, state);
    },
  };
}
// An F-Curve's keys as exact-keys.js reads them, or null.
const curveKeys = (fc) => fc && [...fc.keyframe_points].map((k) => ({ frame: k.co[0], value: k.co[1], interpolation: k.interpolation,
  handle_left: [k.handle_left[0], k.handle_left[1]], handle_right: [k.handle_right[0], k.handle_right[1]] }));

function influenceAnimations(world, mapped) {
  const animated = mapped.filter(({ key }) => key.animation_data);
  const sync = world.mainSync, { fps, frameStart, frameEnd } = world.animation.time.state, current = world.animation.time.frame;
  if (!animated.length || frameEnd <= frameStart) return [];
  const keys = new Map();
  // Each target's own F-Curve, which Babylon plays where its keys are the influence exactly (exact-keys.js).
  const curves = new Map();
  for (let frame = frameStart; frame <= frameEnd; frame++) {
    sync.frameChanged(frame);
    for (const { ob, key, state } of animated) {
      influences(ob, key, state.targets.map((t) => t.name)).forEach((value, i) => {
        const target = state.manager.getTarget(i);
        if (!keys.has(target)) keys.set(target, []);
        keys.get(target).push({ frame, value });
        if (!curves.has(target)) curves.set(target, actionFCurves(key.animation_data).find((fc) => fc.data_path === `key_blocks["${target.name}"].value`));
      });
    }
  }
  sync.frameChanged(current);
  return [...keys].map(([target, list]) => {
    const exact = exactAnimation(`${target.name} influence`, 'influence', curveKeys(curves.get(target)), list.map((k) => k.value), { frameStart, fps });
    if (exact) return { animation: exact, target };
    const animation = new Animation(`${target.name} influence`, 'influence', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys(list);
    return { animation, target };
  });
}

registerRuntime({
  id: 'SHAPE_KEYS', label: 'Shape keys', struct: 'Key', owner: (context) => context.mesh?.shape_keys ?? null, context: 'data', icon: 'SHAPEKEY_DATA',
  runtimes: ['BLENDER', 'MAPPED'],
  settings: (props, kw) => ({
    use_normal_morphing: props.BoolProperty(kw({ name: 'Morph Normals', description: "Normals blended with the positions (MorphTargetManager's enableNormalMorphing)",
      default: true, options: new Set() })),
    use_texture_for_targets: props.BoolProperty(kw({ name: 'Targets in Texture', description: "The targets' data in a texture, not vertex attributes (useTextureToStoreTargets)",
      default: true, options: new Set() })),
  }),
  poll: (key) => key?.rna_type?.identifier === 'Key' && key.user?.rna_type?.identifier === 'Mesh',
  issues,
  instances: (context) => [...new Map([...context.scene.objects].map(meshKey).filter(Boolean).map((key) => [address(key), key])).values()],
  evaluates: (entry) => morphed.has(entry.ob) || exporting.has(entry.ob),
  evaluate,
  export: exportShapeKeys,
});
