// Armature deform on Babylon (docs/runtimes.md, Babylon (mapped)): an armature object's bones and Main's evaluated pose
// as Babylon Skeletons that skin, on the GPU, the meshes its Armature modifiers deform. Blender still poses the bones
// (its animation system, constraints and Pose Mode tools); Babylon deforms the meshes. The same mapping writes the
// skeletons, the skins and the pose's animation in File > Export > Babylon.
import { Animation, Bone, BoundingInfo, Matrix, Skeleton, Vector3, VertexBuffer } from '@babylonjs/core';
import { idStruct, pointerOf } from '../python/bpy_rna.js';
import { babylonMatrix } from '../blenkernel/main-view.js';
import { modifierStack } from '../modifiers/stack.js';
import { registerRuntime, runtimeOf, APPROXIMATION, FALLBACK } from './runtimes.js';
import { livePose } from '../io_scene_babylon/live-curves.js';

// A vertex Blender's Armature modifier leaves in place: its weights sum to no more than this (armature_deform.cc).
const CONTRIBUTION = 0.0001;
const address = (struct) => pointerOf(struct)?.[2] ?? 0;
const matrix = (values) => babylonMatrix(Array.from(values));
const issue = (kind, ob, path, message) => ({ kind, setting: `bpy.data.objects["${ob.name}"].${path}`, message: `${ob.name}: ${message}` });

// The armature's bones, parents first, each with its rest and evaluated pose matrices in armature space (Babylon's axes).
function bonesOf(arm) {
  const ordered = [];
  const visit = (bone) => { ordered.push(bone); for (const child of bone.children) visit(child); };
  for (const bone of arm.data.bones) if (!bone.parent) visit(bone);
  const index = new Map(ordered.map((bone, i) => [bone.name, i]));
  return ordered.map((bone) => ({
    name: bone.name, parent: bone.parent ? index.get(bone.parent.name) : -1, deform: bone.use_deform,
    rest: matrix(bone.matrix_local), pose: matrix(arm.pose.bones.get(bone.name).matrix),
  }));
}

// Blender's Smooth by Angle (Object > Shade Auto Smooth), last in the stack: Babylon skins the mesh smooth instead.
const smoothByAngle = (m) => m.type === 'NODES' && /^Smooth by Angle/.test(m.node_group?.name ?? '');
// A mesh object's modifiers shown in the viewport, but a last Smooth by Angle, and those of them that are Armature
// modifiers deforming by `arm`.
function armatureModifiers(ob, arm) {
  const shown = [...ob.modifiers].filter((m) => m.show_viewport), stack = smoothByAngle(shown.at(-1) ?? {}) ? shown.slice(0, -1) : shown;
  return { stack, mine: stack.filter((m) => m.type === 'ARMATURE' && address(m.object) === address(arm)) };
}

// What of a mesh's deform Babylon cannot evaluate, so that the mesh deforms as Blender. Babylon skins the object's Mesh
// as Main holds it: the Armature modifier has to be the only one, on a Mesh without shape keys.
function meshFallbacks(ob, arm) {
  const { stack, mine } = armatureModifiers(ob, arm), [modifier] = mine, at = stack.indexOf(modifier);
  const path = (name) => `modifiers["${modifier.name}"].${name}`, out = [];
  if (mine.length > 1) out.push(issue(FALLBACK, ob, 'modifiers', 'two Armature modifiers'));
  if (at > 0) out.push(issue(FALLBACK, ob, path('show_viewport'), `Armature after ${stack[0].name}`));
  if (stack.length > at + 1) out.push(issue(FALLBACK, ob, path('show_viewport'), `${stack[at + 1].name} after Armature`));
  if (modifier.use_multi_modifier) out.push(issue(FALLBACK, ob, path('use_multi_modifier'), 'Multi Modifier'));
  if (ob.data.shape_keys) out.push(issue(FALLBACK, ob, 'data.shape_keys', 'shape keys before Armature'));
  return out;
}

// What Babylon evaluates differently from Blender for a mesh it skins.
function meshApproximations(ob, arm, modifier) {
  const path = (name) => `modifiers["${modifier.name}"].${name}`;
  const out = [issue(APPROXIMATION, ob, `modifiers["${modifier.name}"]`, 'normals skinned, not recomputed')];
  const smooth = [...ob.modifiers].findLast((m) => m.show_viewport);
  if (smooth && smoothByAngle(smooth)) out.push(issue(APPROXIMATION, ob, `modifiers["${smooth.name}"]`, 'Smooth by Angle after Armature: shaded smooth'));
  if (modifier.use_deform_preserve_volume) out.push(issue(APPROXIMATION, ob, path('use_deform_preserve_volume'), 'Preserve Volume skins linearly'));
  if (modifier.use_bone_envelopes) out.push(issue(APPROXIMATION, ob, path('use_bone_envelopes'), 'envelopes do not deform'));
  if (!modifier.use_vertex_groups) return out;
  const groups = new Set([...ob.vertex_groups].map((g) => g.name));
  for (const bone of arm.data.bones) {
    if (!bone.use_deform || !groups.has(bone.name)) continue;
    const at = `data.bones["${bone.name}"]`;
    if (bone.bbone_segments > 1) out.push(issue(APPROXIMATION, arm, `${at}.bbone_segments`, `${bone.name} deforms as one B-Bone segment`));
    if (bone.use_envelope_multiply) out.push(issue(APPROXIMATION, arm, `${at}.use_envelope_multiply`, `${bone.name} envelope multiply ignored`));
  }
  return out;
}

// Each Main vertex's weights as Blender's Armature modifier deforms by them (armature_deform.cc): the vertex groups of
// deforming bones, normalized by their sum, the modifier's vertex group scaling the deform; what is left of the weight
// goes to `identity` (Babylon's skeletons end with an identity matrix), so a vertex without weights keeps its place.
// Strongest first.
function vertexWeights(ob, bones, modifier) {
  const groups = [...ob.vertex_groups].map((g) => g.name), identity = bones.length;
  const boneOf = groups.map((name) => (modifier.use_vertex_groups ? bones.findIndex((b) => b.name === name && b.deform) : -1));
  const mask = modifier.vertex_group ? groups.indexOf(modifier.vertex_group) : -1;
  return Array.from(ob.data.vertices, (vertex) => {
    const weights = [];
    let scale = mask >= 0 ? 0 : 1, sum = 0;
    for (const { group, weight } of vertex.groups) {
      if (group === mask) scale = weight;
      if (boneOf[group] >= 0 && weight !== 0) { weights.push([boneOf[group], weight]); sum += weight; }
    }
    if (mask >= 0 && modifier.invert_vertex_group) scale = 1 - scale;
    if (!(sum > CONTRIBUTION) || scale === 0) return [[identity, 1]];
    const out = weights.map(([bone, weight]) => [bone, (weight / sum) * scale]);
    if (scale !== 1) out.push([identity, 1 - scale]);
    return out.sort((a, b) => b[1] - a[1]);
  });
}

// Babylon's influencers per vertex: 4, or 8 with the extra buffers; AUTO is the fewest that hold every vertex's weights.
const influencersFor = (setting, perVertex) => (setting === 'AUTO' ? (perVertex.some((list) => list.length > 4) ? 8 : 4) : Number(setting));

// Babylon's skin buffers for a Mesh's corners (Babylon's vertices, mesh-batch-cache.js): each corner's vertex's
// strongest weights, normalized again where some were left out; and how many vertices lost weights.
function skinBuffers(mesh, perVertex, influencers) {
  const corners = mesh.corners_num, kinds = influencers / 4;
  const indices = Array.from({ length: kinds }, () => new Float32Array(corners * 4)), weights = indices.map(() => new Float32Array(corners * 4));
  const kept = perVertex.map((list) => {
    const top = list.slice(0, influencers), sum = top.reduce((s, [, w]) => s + w, 0);
    return top.map(([bone, w]) => [bone, w / sum]);
  });
  const { corner_verts } = mesh;
  for (let c = 0; c < corners; c++) kept[corner_verts[c]].forEach(([bone, w], i) => { indices[i >> 2][c * 4 + (i & 3)] = bone; weights[i >> 2][c * 4 + (i & 3)] = w; });
  return { indices, weights, influencers, truncated: perVertex.filter((list) => list.length > influencers).length };
}
const truncation = (ob, { truncated, influencers }) => (truncated ? [issue(APPROXIMATION, ob, 'vertex_groups', `${truncated} vertices over ${influencers} influencers`)] : []);

// A bone's matrix relative to its parent's; a root's relative to the skinned mesh (`space`: armature to mesh).
const relative = (bones, i, key, space) => {
  const { parent } = bones[i];
  return bones[i][key].multiply(parent < 0 ? space : Matrix.Invert(bones[parent][key]));
};
// Babylon's matrix property of a bone, which matrix animations of bones key (the .babylon format's "_matrix").
const BONE_MATRIX = '_matrix';

// A Skeleton of the bones for meshes whose armature-to-mesh matrix is `space`; one per rest pose and space, so editing
// the bones makes a new one.
function skeletonOf(name, bones, space, scene) {
  const skeleton = new Skeleton(name, name, scene);
  bones.forEach((bone, i) => {
    const rest = relative(bones, i, 'rest', space);
    const made = new Bone(bone.name, skeleton, bone.parent < 0 ? null : skeleton.bones[bone.parent], relative(bones, i, 'pose', space), rest, rest);
    made.id = `${name} ${bone.name}`;
  });
  return Object.assign(skeleton, { space });
}
const restSignature = (bones, space) => JSON.stringify([bones.map((b) => [b.name, b.parent, Array.from(b.rest.m)]), Array.from(space.m)]);

// An armature object (RNA's Object) mapped into Babylon in `scene`: a Skeleton per armature-to-mesh matrix and each
// skinned mesh object's skin, by Object address; `issues` of the last update. update() poses the skeletons from Main's
// evaluated pose and rebuilds what changed (bones, weights, placement, influencers).
export function mapArmature(arm, scene) {
  const skeletons = new Map(), skins = new Map();
  let bones = bonesOf(arm);
  const mapping = { arm, skeletons, skins, issues: [], update, dispose };

  // objects: the mesh objects to look at (RNA's Objects); meshOf(ob): the Mesh Babylon draws for one (its corners are
  // the skin's vertices); changed(ob): whether its Mesh changed since the last update; fallbacks(ob): issues of the
  // view's own (a mesh Babylon draws itself); influencers: the setting.
  function update({ objects, meshOf, changed = () => false, fallbacks = () => [], influencers = 'AUTO' }) {
    bones = bonesOf(arm);
    const armatureWorld = matrix(arm.matrix_world);
    const issues = [], deformed = new Map();
    for (const ob of objects.filter((o) => o.type === 'MESH' && armatureModifiers(o, arm).mine.length)) {
      const own = [...meshFallbacks(ob, arm), ...fallbacks(ob)];
      issues.push(...own);
      if (!own.length) deformed.set(address(ob), ob);
    }
    const used = new Set();
    for (const [key, ob] of deformed) {
      const space = armatureWorld.multiply(Matrix.Invert(matrix(ob.matrix_world))), id = restSignature(bones, space);
      if (!skeletons.has(id)) skeletons.set(id, skeletonOf(deformed.size > 1 ? `${arm.name} ${ob.name}` : arm.name, bones, space, scene));
      const skeleton = skeletons.get(id), modifier = armatureModifiers(ob, arm).mine[0];
      used.add(skeleton);
      let skin = skins.get(key);
      if (!skin || skin.skeleton !== skeleton || skin.setting !== influencers || changed(ob)) {
        const perVertex = vertexWeights(ob, bones, modifier);
        skin = { ob: key, skeleton, setting: influencers, ...skinBuffers(meshOf(key), perVertex, influencersFor(influencers, perVertex)) };
        skins.set(key, skin);
      }
      issues.push(...meshApproximations(ob, arm, modifier).filter((i) => !issues.some((j) => j.setting === i.setting)), ...truncation(ob, skin));
    }
    for (const [id, skeleton] of skeletons) if (!used.has(skeleton)) { skeleton.dispose(); skeletons.delete(id); }
    for (const key of skins.keys()) if (!deformed.has(key)) skins.delete(key);
    for (const skeleton of used) {
      skeleton.bones.forEach((bone, i) => { bone[BONE_MATRIX] = relative(bones, i, 'pose', skeleton.space); });
      // Now, not at the next render: bounds and picking read the matrices before it.
      skeleton.prepare(true);
    }
    mapping.issues = issues;
    return mapping;
  }
  function dispose() {
    for (const skeleton of skeletons.values()) skeleton.dispose();
    skeletons.clear();
    skins.clear();
  }
  return mapping;
}

const INDICES = [VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesIndicesExtraKind];
const WEIGHTS = [VertexBuffer.MatricesWeightsKind, VertexBuffer.MatricesWeightsExtraKind];
// A Babylon mesh skinned by a skin: its skeleton, influencers and vertex buffers.
export function applySkin(node, skin) {
  INDICES.forEach((kind, i) => (skin.indices[i] ? node.setVerticesData(kind, skin.indices[i], false, 4) : node.removeVerticesData(kind)));
  WEIGHTS.forEach((kind, i) => (skin.weights[i] ? node.setVerticesData(kind, skin.weights[i], false, 4) : node.removeVerticesData(kind)));
  node.numBoneInfluencers = skin.influencers;
  node.skeleton = skin.skeleton;
}
function removeSkin(node) {
  node.skeleton = null;
  [...INDICES, ...WEIGHTS].forEach((kind) => node.removeVerticesData(kind));
}

// A skinned mesh's bounds in its pose without skinning it: each matrix's box of the vertices it moves, moved by it.
// A skinned vertex is a weighted mean of its matrices' moves of it, so the boxes' union holds it.
function boneBoxes(node, skin) {
  const positions = node.getVerticesData(VertexBuffer.PositionKind), boxes = new Map();
  for (let c = 0; c < positions.length / 3; c++) {
    for (let i = 0; i < skin.influencers; i++) {
      if (!skin.weights[i >> 2][c * 4 + (i & 3)]) continue;
      const bone = skin.indices[i >> 2][c * 4 + (i & 3)], box = boxes.get(bone) ?? boxes.set(bone, [Vector3.One().scale(Infinity), Vector3.One().scale(-Infinity)]).get(bone);
      const p = Vector3.FromArray(positions, c * 3);
      box[0].minimizeInPlace(p);
      box[1].maximizeInPlace(p);
    }
  }
  return boxes;
}
function poseBounds(node, boxes) {
  const matrices = node.skeleton.getTransformMatrices(node), min = Vector3.One().scale(Infinity), max = Vector3.One().scale(-Infinity);
  for (const [bone, [a, b]] of boxes) {
    const m = Matrix.FromArray(matrices, bone * 16);
    for (let k = 0; k < 8; k++) {
      const p = Vector3.TransformCoordinates(new Vector3(k & 1 ? b.x : a.x, k & 2 ? b.y : a.y, k & 4 ? b.z : a.z), m);
      min.minimizeInPlace(p);
      max.maximizeInPlace(p);
    }
  }
  node.setBoundingInfo(new BoundingInfo(min, max));
}

// The view's mappings, by armature Object address: { mapping, applied: skins drawn, by mesh Object address }.
const mapped = new Map();
let skinned = new Set(), lastView = null;
// Meshes skinned for an export only: the view keeps their rest mesh drawn while the export evaluates other frames.
const exporting = new Set();
const settingsOf = (arm) => arm.bylonder?.babylon;

// Draws a mapping's skins on their meshes (the Mesh Main holds, skinned) and the meshes it no longer skins as Blender
// evaluated them. A posed mesh gets bounds and picking positions of its pose: skinned on the CPU once the pose holds
// still, from its bones' boxes while the animation plays.
function drawSkins(view, state, meshOf) {
  const byOb = new Map([...view.entries()].map((entry) => [entry.ob, entry]));
  for (const [key, skin] of state.mapping.skins) {
    const { node } = byOb.get(key);
    if (state.applied.get(key)?.skin !== skin) {
      view.drawMesh(byOb.get(key), meshOf(key));
      applySkin(node, skin);
      state.applied.set(key, { skin, boxes: boneBoxes(node, skin) });
    }
    skin.skeleton.useTextureToStoreBoneMatrices = settingsOf(state.mapping.arm)?.use_texture_for_matrices ?? true;
    if (view.world.animation?.playing) poseBounds(node, state.applied.get(key).boxes);
    else node.refreshBoundingInfo({ applySkeleton: true });
  }
  for (const key of [...state.applied.keys()]) if (!state.mapping.skins.has(key)) unskin(view, byOb.get(key), state, key);
}
function unskin(view, entry, state, key) {
  state.applied.delete(key);
  if (!entry) return;
  removeSkin(entry.node);
  view.drawGeometry(entry);
}

// The mappings after Main was evaluated: one per armature object on Babylon (mapped) and not in Edit Mode, updated to
// Main's pose, data and weights; the others' meshes drawn as Blender evaluated them again. Returns the armatures seen.
function evaluate(view) {
  lastView = view;
  const entries = [...view.entries()], byOb = new Map(entries.map((entry) => [entry.ob, entry]));
  const armatures = entries.filter((entry) => entry.type === 'ARMATURE').map((entry) => idStruct(entry.ob));
  const meshes = entries.filter((entry) => entry.type === 'MESH').map((entry) => idStruct(entry.ob));
  const live = new Set();
  for (const arm of armatures) {
    if (runtimeOf(arm) !== 'MAPPED' || arm.mode === 'EDIT') continue;
    const key = address(arm);
    live.add(key);
    if (!mapped.has(key)) mapped.set(key, { mapping: mapArmature(arm, view.scene), applied: new Map() });
    const state = mapped.get(key), bases = new Map();
    const meshOf = (ob) => bases.get(ob) ?? bases.set(ob, view.blender.mesh(ob)).get(ob);
    state.mapping.update({
      objects: meshes, meshOf, influencers: settingsOf(arm)?.influencers,
      changed: (ob) => view.updates.has(byOb.get(address(ob)).data.ptr),
      fallbacks: (ob) => viewFallbacks(view, byOb.get(address(ob)), ob),
    });
    drawSkins(view, state, meshOf);
  }
  for (const [key, state] of mapped) {
    if (live.has(key)) continue;
    for (const meshKey of [...state.applied.keys()]) unskin(view, byOb.get(meshKey), state, meshKey);
    state.mapping.dispose();
    mapped.delete(key);
  }
  skinned = new Set([...mapped.values()].flatMap((state) => [...state.applied.keys()]));
  return armatures;
}
// A mesh the view does not draw from Main's Mesh (Babylon's own geometry), or with Bylonder's modifiers after Blender's,
// deforms as Blender; one whose geometry is being edited (Edit Mode, Sculpt Mode) too, as editing is Blender's.
const EDITING = ['EDIT', 'SCULPT'];
function viewFallbacks(view, entry, ob) {
  if (entry.overlay || EDITING.includes(ob.mode)) return [{ kind: FALLBACK, setting: null, message: `${ob.name}: being edited`, silent: true }];
  if (!view.drawsGeometry(entry)) return [issue(FALLBACK, ob, 'data', "Babylon's own geometry")];
  if (modifierStack(entry.node).some((m) => m.showViewport)) return [issue(FALLBACK, ob, 'modifiers', "Bylonder's modifiers after Armature")];
  return [];
}

// The issues of an armature object's deform on Babylon: the view's mapping's, else a mapping made for the question.
function issues(arm) {
  const state = mapped.get(address(arm));
  if (state) return state.mapping.issues.filter((i) => !i.silent);
  if (!lastView) return [];
  const mapping = mapArmature(arm, lastView.scene), byOb = new Map([...lastView.entries()].map((entry) => [entry.ob, entry]));
  const meshes = [...lastView.entries()].filter((entry) => entry.type === 'MESH').map((entry) => idStruct(entry.ob));
  mapping.update({ objects: meshes, meshOf: (key) => lastView.blender.mesh(key), influencers: settingsOf(arm)?.influencers, fallbacks: (ob) => viewFallbacks(lastView, byOb.get(address(ob)), ob) });
  mapping.dispose();
  return mapping.issues.filter((i) => !i.silent);
}

// The pose as matrix animations of a mapping's bones, read from Main as Blender's animation system evaluates it, keyed
// on the armature's grid (sampling.js); one key when nothing animates the armature. The page interpolates matrix keys
// (Animation.AllowMatricesInterpolation). Without `bake`, a bone of an armature drawn by one skeleton whose F-Curves give
// its pose (live-curves.js livePose, checked at each whole frame) is posed by the page instead: its F-Curves go in
// `curves`, and each bone still sampled while it moves in `gaps`.
function poseAnimations(world, mappings, bake, sampling) {
  const sync = world.mainSync, { fps, frameStart, frameEnd } = sampling.range, current = world.animation.time.frame;
  const animated = (arm) => !!arm.animation_data || [...arm.pose.bones].some((bone) => bone.constraints.length);
  const keys = new Map(), owners = new Map();
  const sample = (frame) => {
    for (const mapping of mappings) {
      const bones = bonesOf(mapping.arm);
      for (const skeleton of mapping.skeletons.values()) skeleton.bones.forEach((bone, i) => {
        if (!keys.has(bone)) { keys.set(bone, []); owners.set(bone, mapping); }
        keys.get(bone).push({ frame, value: relative(bones, i, 'pose', skeleton.space) });
      });
    }
  };
  if (mappings.some((m) => animated(m.arm)) && frameEnd > frameStart) {
    for (const frame of sampling.frames) { sync.frameChanged(frame); sample(frame); }
    sync.frameChanged(current);
  } else sample(current);
  const curves = [], gaps = [];
  const animations = [...keys].flatMap(([bone, list]) => {
    const { arm, skeletons } = owners.get(bone);
    const whole = list.filter((k) => Number.isInteger(k.frame));
    const live = !bake && skeletons.size === 1 && livePose(arm, arm.pose.bones.get(bone.name), bone, whole.map((k) => k.value), whole[0].frame);
    if (live) curves.push(...live);
    if (live?.length) return [];
    const moves = list.some((k) => !k.value.equalsWithEpsilon(list[0].value, 1e-6));
    if (!bake && moves) gaps.push({ message: `${arm.name} ${bone.name}: its pose is not its F-Curves alone (constraints, IK, NLA, drivers, inheritance, several skeletons) or the unit misses Main` });
    const animation = new Animation(`${bone.id} pose`, BONE_MATRIX, fps, Animation.ANIMATIONTYPE_MATRIX, Animation.ANIMATIONLOOPMODE_CYCLE);
    const keeps = moves && sampling.keeps(arm.name);
    animation.setKeys(moves ? list.filter(({ frame }) => keeps(frame)) : list.slice(0, 1));
    return [{ animation, target: bone }];
  });
  return { animations, curves, gaps };
}

// Export: every armature mapped, those on Blender for the export's duration (their meshes skinned, then drawn as
// Blender evaluated them again), with their issues and their pose's animation.
function exportArmatures(world, { bake, sampling }) {
  const view = lastView;
  if (!view || !world.mainSync) return { reports: [], animations: [], restore() {} };
  const entries = [...view.entries()], meshes = entries.filter((e) => e.type === 'MESH').map((e) => idStruct(e.ob)), byOb = new Map(entries.map((e) => [e.ob, e]));
  const temporary = [], mappings = [];
  for (const arm of entries.filter((e) => e.type === 'ARMATURE').map((e) => idStruct(e.ob))) {
    const live = mapped.get(address(arm));
    if (live) { mappings.push(live.mapping); continue; }
    const state = { mapping: mapArmature(arm, view.scene), applied: new Map() }, meshOf = (key) => view.blender.mesh(key);
    state.mapping.update({ objects: meshes, meshOf, influencers: settingsOf(arm)?.influencers, fallbacks: (ob) => viewFallbacks(view, byOb.get(address(ob)), ob) });
    if (!state.mapping.skins.size) { state.mapping.dispose(); continue; }
    temporary.push(state);
    mappings.push(state.mapping);
  }
  const { animations, curves, gaps } = poseAnimations(world, mappings, bake, sampling);
  for (const state of temporary) {
    drawSkins({ ...view, world: { animation: { playing: true } } }, state, (key) => view.blender.mesh(key));
    for (const key of state.applied.keys()) exporting.add(key);
  }
  return {
    reports: mappings.map((m) => ({ title: `${m.arm.name}: exported`, issues: m.issues.filter((i) => !i.silent) })),
    animations, curves, gaps,
    clip: (sampling, owns) => poseAnimations(world, mappings.filter((m) => owns(m.arm)), true, sampling).animations,
    restore() {
      exporting.clear();
      for (const state of temporary) {
        for (const key of [...state.applied.keys()]) unskin(view, byOb.get(key), state, key);
        state.mapping.dispose();
      }
    },
  };
}

registerRuntime({
  id: 'ARMATURE', label: 'Armature deform', struct: 'Object', owner: 'object', context: 'data', icon: 'OUTLINER_OB_ARMATURE', runtimes: ['BLENDER', 'MAPPED'],
  settings: (props, kw) => ({
    influencers: props.EnumProperty(kw({ name: 'Influencers', description: "Bone influences per vertex Babylon skins with (a mesh's numBoneInfluencers)",
      items: [['AUTO', 'Automatic', 'The fewest that hold every weight: 4, or 8 when a vertex has more than 4'], ['4', '4', '4 influences per vertex'], ['8', '8', '8 influences per vertex, in extra buffers']],
      default: 'AUTO', options: new Set() })),
    use_texture_for_matrices: props.BoolProperty(kw({ name: 'Bone Matrices in Texture', description: "The skeleton's bone matrices in a texture, not uniforms (useTextureToStoreBoneMatrices)",
      default: true, options: new Set() })),
  }),
  poll: (ob) => ob.type === 'ARMATURE',
  note: (ob) => (ob.mode === 'EDIT' ? 'Edit Mode evaluates as Blender' : null),
  issues,
  instances: (context) => [...context.scene.objects].filter((ob) => ob.type === 'ARMATURE'),
  evaluates: (entry) => skinned.has(entry.ob) || exporting.has(entry.ob),
  evaluate,
  export: exportArmatures,
});
