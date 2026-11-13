// Armature deform on Babylon (docs/runtimes.md, Babylon (mapped)): an armature object's bones and Main's evaluated pose
// as Babylon Skeletons that skin, on the GPU, the meshes its Armature modifiers deform. Blender still poses the bones
// (its animation system, constraints and Pose Mode tools); Babylon deforms the meshes. The same mapping writes the
// skeletons, the skins and the pose's animation in File > Export > Babylon.
import { Animation, Bone, BoundingInfo, Matrix, Skeleton, Vector3, VertexBuffer } from '@babylonjs/core';
import { idStruct, pointerOf } from '../python/bpy_rna.js';
import { babylonMatrix } from '../blenkernel/main-view.js';
import { modifierStack } from '../modifiers/stack.js';
import { registerRuntime, runtimeOf, APPROXIMATION, FALLBACK } from './runtimes.js';
import { report } from '../windowmanager/wm-reports.js';
import { drivenPose, livePose } from '../io_scene_babylon/live-curves.js';
import { livePoseConstraints, ownMatrix } from '../io_scene_babylon/pose-export.js';
import { keyedVertices } from './key-blocks.js';
import { useDualQuaternionSkinning } from '../io_scene_babylon/runtime/dual-quaternion-skinning.js';
import { appliedRests, shownStack, smoothByAngle } from './applied-rest.js';

// A vertex Blender's Armature modifier leaves in place: its weights sum to no more than this (armature_deform.cc).
const CONTRIBUTION = 0.0001;
const address = (struct) => pointerOf(struct)?.[2] ?? 0;
const matrix = (values) => babylonMatrix(Array.from(values));
const issue = (kind, ob, path, message) => ({ kind, ob: ob.name, setting: `bpy.data.objects["${ob.name}"].${path}`, message: `${ob.name}: ${message}` });

// The armature's bones, parents first, each with its rest and evaluated pose matrices in armature space (Babylon's
// axes); then, with `segments`, the joints of each deforming B-Bone's segments (Blender's bbone_segment_matrix, in the
// bone's space) as bones of its own, `segment` the bone's index and the joint's.
function bonesOf(arm, segments = false) {
  const ordered = [];
  const visit = (bone) => { ordered.push(bone); for (const child of bone.children) visit(child); };
  for (const bone of arm.data.bones) if (!bone.parent) visit(bone);
  const index = new Map(ordered.map((bone, i) => [bone.name, i]));
  const bones = ordered.map((bone) => ({
    name: bone.name, parent: bone.parent ? index.get(bone.parent.name) : -1, deform: bone.use_deform,
    rest: matrix(bone.matrix_local), pose: matrix(arm.pose.bones.get(bone.name).matrix),
  }));
  if (!segments) return bones;
  ordered.forEach((bone, i) => {
    if (!bbone(bone)) return;
    const pose = arm.pose.bones.get(bone.name);
    for (let k = 0; k <= bone.bbone_segments; k++) bones.push({ name: `${bone.name}#${k}`, parent: i, deform: false, segment: [i, k],
      rest: matrix(pose.bbone_segment_matrix(k, true)).multiply(bones[i].rest), pose: matrix(pose.bbone_segment_matrix(k, false)).multiply(bones[i].pose) });
  });
  return bones;
}
// Whether a deforming bone is posed with scale or shear, which dual quaternion skinning blends otherwise than Blender.
function scaledBones(bones) {
  const scale = new Vector3();
  return bones.some((b) => (b.deform || b.segment) && (Matrix.Invert(b.rest).multiply(b.pose).decompose(scale), !scale.equalsWithEpsilon(Vector3.One(), 1e-4)));
}
// The bones of a skeleton that skinning reads: the armature's deforming bones, the joints of its deforming B-Bones'
// segments, and every bone above them, so their matrices still compose. Others matter to a page only where the rig's
// constraints run live, reading or posing them.
export function skinningBones(arm, skeleton) {
  const deforms = (bone) => arm.data.bones.get(bone.name.split('#')[0])?.use_deform;
  const kept = new Set();
  for (const bone of skeleton.bones) {
    if (!deforms(bone)) continue;
    for (let at = bone; at && !kept.has(at); at = at.getParent()) kept.add(at);
  }
  return kept;
}
// A Babylon bone of a B-Bone's segment joint.
const isJoint = (bone) => bone.getSkeleton().bones.indexOf(bone) >= bone.getSkeleton().armatureBones;
// A bone that deforms as B-Bone segments.
const bbone = (bone) => bone.use_deform && bone.bbone_segments > 1;
const segmentsOf = (arm) => settingsOf(arm)?.use_bbone_segments ?? true;
const dualQuaternionsOf = (arm) => settingsOf(arm)?.use_dual_quaternions ?? true;

// A mesh object's modifiers shown in the viewport, but a last Smooth by Angle and those its applied rest holds
// (`applied`, names), and those of them that are Armature modifiers deforming by `arm`.
function armatureModifiers(ob, arm, applied = []) {
  const stack = shownStack(ob).filter((m) => !applied.includes(m.name));
  return { stack, mine: stack.filter((m) => m.type === 'ARMATURE' && address(m.object) === address(arm)) };
}

// What of a mesh's deform Babylon cannot evaluate, so that the mesh deforms as Blender. Babylon skins the object's Mesh
// as Main holds it, after its shape keys' morph targets (shape-keys.js), as Blender deforms after the keys: the Armature
// modifier has to be the only one, but for those an export applies into the rest mesh (applied-rest.js).
function meshFallbacks(ob, arm, applied) {
  const { stack, mine } = armatureModifiers(ob, arm, applied), [modifier] = mine, at = stack.indexOf(modifier);
  const path = (name) => `modifiers["${modifier.name}"].${name}`, out = [];
  if (mine.length > 1) out.push(issue(FALLBACK, ob, 'modifiers', 'two Armature modifiers'));
  if (at > 0) out.push(issue(FALLBACK, ob, path('show_viewport'), `Armature after ${stack[0].name}`));
  if (stack.length > at + 1) out.push(issue(FALLBACK, ob, path('show_viewport'), `${stack[at + 1].name} after Armature`));
  if (modifier.use_multi_modifier) out.push(issue(FALLBACK, ob, path('use_multi_modifier'), 'Multi Modifier'));
  return out;
}

// What Babylon evaluates differently from Blender for a mesh it skins.
function meshApproximations(ob, arm, modifier) {
  const path = (name) => `modifiers["${modifier.name}"].${name}`;
  const out = [issue(APPROXIMATION, ob, `modifiers["${modifier.name}"]`, 'normals skinned, not recomputed')];
  const smooth = [...ob.modifiers].findLast((m) => m.show_viewport);
  if (smooth && smoothByAngle(smooth)) out.push(issue(APPROXIMATION, ob, `modifiers["${smooth.name}"]`, 'Smooth by Angle after Armature: shaded smooth'));
  if (modifier.use_deform_preserve_volume && !dualQuaternionsOf(arm)) out.push(issue(APPROXIMATION, ob, path('use_deform_preserve_volume'), 'Preserve Volume skins linearly'));
  if (modifier.use_bone_envelopes) out.push(issue(APPROXIMATION, ob, path('use_bone_envelopes'), 'envelopes do not deform'));
  if (!modifier.use_vertex_groups) return out;
  const groups = new Set([...ob.vertex_groups].map((g) => g.name));
  for (const bone of arm.data.bones) {
    if (!bone.use_deform || !groups.has(bone.name)) continue;
    const at = `data.bones["${bone.name}"]`;
    if (bbone(bone) && !segmentsOf(arm)) out.push(issue(APPROXIMATION, arm, `${at}.bbone_segments`, `${bone.name} deforms as one B-Bone segment`));
    if (bone.use_envelope_multiply) out.push(issue(APPROXIMATION, arm, `${at}.use_envelope_multiply`, `${bone.name} envelope multiply ignored`));
  }
  return out;
}

// Each Main vertex's weights as Blender's Armature modifier deforms by them (armature_deform.cc): the vertex groups of
// deforming bones, normalized by their sum, the modifier's vertex group scaling the deform; what is left of the weight
// goes to `identity` (Babylon's skeletons end with an identity matrix), so a vertex without weights keeps its place.
// Strongest first. A B-Bone's weight is split between the two joints of the segment the vertex lies in, as Blender's
// PoseBone.bbone_segment_index places its position (`space`: mesh to armature): its reference key's, where Blender
// places it after the shape keys; `keyed` counts those its keys move.
function vertexWeights(ob, bones, modifier, arm, space) {
  const groups = [...ob.vertex_groups].map((g) => g.name), identity = bones.length;
  const boneOf = groups.map((name) => (modifier.use_vertex_groups ? bones.findIndex((b) => b.name === name && b.deform) : -1));
  const joints = new Map(bones.flatMap((b, i) => (b.segment?.[1] === 0 ? [[b.segment[0], i]] : [])));
  const mask = modifier.vertex_group ? groups.indexOf(modifier.vertex_group) : -1;
  const split = (bone, weight, co) => {
    const [segment, blend] = arm.pose.bones.get(bones[bone].name).bbone_segment_index(armaturePoint(co, space));
    return [[joints.get(bone) + segment, weight * (1 - blend)], [joints.get(bone) + segment + 1, weight * blend]].filter(([, w]) => w);
  };
  const moved = joints.size ? keyedVertices(ob.data) : new Set();
  let keyed = 0;
  const perVertex = Array.from(ob.data.vertices, (vertex, v) => {
    const weights = [];
    let scale = mask >= 0 ? 0 : 1, sum = 0;
    for (const { group, weight } of vertex.groups) {
      if (group === mask) scale = weight;
      if (boneOf[group] >= 0 && weight !== 0) { weights.push([boneOf[group], weight]); sum += weight; }
    }
    if (mask >= 0 && modifier.invert_vertex_group) scale = 1 - scale;
    if (!(sum > CONTRIBUTION) || scale === 0) return [[identity, 1]];
    if (moved.has(v) && weights.some(([bone]) => joints.has(bone))) keyed++;
    const out = weights.flatMap(([bone, weight]) => (joints.has(bone) ? split(bone, weight, vertex.co) : [[bone, weight]]))
      .map(([bone, weight]) => [bone, (weight / sum) * scale]);
    if (scale !== 1) out.push([identity, 1 - scale]);
    return out.sort((a, b) => b[1] - a[1]);
  });
  return { perVertex, keyed };
}

// A mesh's point (Blender's axes) in its armature's space, Blender's axes, `space` the mesh's matrix relative to the
// armature's (Babylon's).
function armaturePoint([x, y, z], space) {
  const p = Vector3.TransformCoordinates(new Vector3(x, z, y), space);
  return [p.x, p.z, p.y];
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
const skinIssues = (ob, { truncated, influencers, keyed }) => [
  ...(truncated ? [issue(APPROXIMATION, ob, 'vertex_groups', `${truncated} vertices over ${influencers} influencers`)] : []),
  ...(keyed ? [issue(APPROXIMATION, ob, 'data.shape_keys', `${keyed} vertices on B-Bones keep the segments of their Basis shape`)] : []),
];

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
  // The armature's own bones come first, the B-Bone joints after them.
  return Object.assign(skeleton, { space, armatureBones: bones.filter((b) => !b.segment).length });
}
const restSignature = (bones, space) => JSON.stringify([bones.map((b) => [b.name, b.parent, Array.from(b.rest.m)]), Array.from(space.m)]);

// An armature object (RNA's Object) mapped into Babylon in `scene`: a Skeleton per armature-to-mesh matrix and each
// skinned mesh object's skin, by Object address; `apart`, the mesh objects it deforms that Babylon cannot skin for their
// modifier stack alone (the native rig runtime may deform them), by Object address; `issues` of the last update. update() poses the skeletons from Main's
// evaluated pose and rebuilds what changed (bones, weights, placement, influencers).
export function mapArmature(arm, scene) {
  const skeletons = new Map(), skins = new Map();
  let bones = bonesOf(arm);
  const mapping = { arm, skeletons, skins, apart: new Map(), issues: [], update, dispose };

  // objects: the mesh objects to look at (RNA's Objects); meshOf(ob): the Mesh Babylon draws for one (its corners are
  // the skin's vertices); changed(ob): whether its Mesh changed since the last update; fallbacks(ob): issues of the
  // view's own (a mesh Babylon draws itself); influencers: the setting; restOf(ob): an export's applied rest of it
  // (applied-rest.js), whose Mesh meshOf gives and whose weights it skins by; skinned: those skinned by their Armature
  // alone, whatever else their stacks hold (an export's choice, armature.js poseAnimations).
  function update({ objects, meshOf, changed = () => false, fallbacks = () => [], influencers = 'AUTO', restOf = () => null, skinned = new Set(), native = new Set() }) {
    bones = bonesOf(arm, segmentsOf(arm));
    const armatureWorld = matrix(arm.matrix_world);
    const issues = [], deformed = new Map(), rests = new Map();
    mapping.apart.clear();
    for (const ob of objects.filter((o) => o.type === 'MESH' && armatureModifiers(o, arm).mine.length)) {
      const rest = restOf(ob);
      if (rest) rests.set(address(ob), rest);
      const stack = meshFallbacks(ob, arm, rest?.applied), view = fallbacks(ob);
      issues.push(...stack, ...view);
      if (!view.length && (!stack.length || skinned.has(ob.name)) && !native.has(ob.name)) deformed.set(address(ob), ob);
      else if (!view.length) mapping.apart.set(address(ob), ob);
    }
    const used = new Set(), spaceOf = (ob) => armatureWorld.multiply(Matrix.Invert(matrix(ob.matrix_world)));
    // One skeleton in one mesh's space (the one it has, while its bones' rest holds); a mesh placed apart reads it
    // through its pose matrix, the change from that space to its own (Babylon's needInitialSkinMatrix).
    const [first] = deformed.values(), kept = [...skeletons.entries()].find(([id, skeleton]) => id === restSignature(bones, skeleton.space));
    const base = kept?.[1].space ?? (first && spaceOf(first)), id = base && restSignature(bones, base);
    if (first && !skeletons.has(id)) skeletons.set(id, skeletonOf(deformed.size > 1 ? `${arm.name} ${first.name}` : arm.name, bones, base, scene));
    const poses = new Map([...deformed].map(([key, ob]) => [key, Matrix.Invert(base).multiply(spaceOf(ob))]));
    const apart = [...poses.values()].some((pose) => !pose.isIdentity());
    // The skeleton stays when no mesh skins to it any more (all on the native runtime): the page poses it.
    if (kept) used.add(kept[1]);
    if (first) skeletons.get(id).needInitialSkinMatrix = apart;
    for (const [key, ob] of deformed) {
      const space = spaceOf(ob), pose = poses.get(key);
      const skeleton = skeletons.get(id), modifier = armatureModifiers(ob, arm).mine[0];
      used.add(skeleton);
      let skin = skins.get(key);
      const dualQuaternions = modifier.use_deform_preserve_volume && dualQuaternionsOf(arm);
      if (!skin || skin.skeleton !== skeleton || skin.apart !== apart || !skin.pose.equalsWithEpsilon(pose, 1e-6) || skin.setting !== influencers || skin.dualQuaternions !== dualQuaternions || changed(ob)) {
        const { perVertex, keyed } = vertexWeights(rests.get(key)?.ob ?? ob, bones, modifier, arm, Matrix.Invert(space));
        skin = { ob: key, skeleton, pose, apart, setting: influencers, keyed, dualQuaternions, ...skinBuffers(meshOf(key), perVertex, influencersFor(influencers, perVertex)) };
        skins.set(key, skin);
      }
      issues.push(...meshApproximations(ob, arm, modifier).filter((i) => !issues.some((j) => j.setting === i.setting)), ...skinIssues(ob, skin));
      const rest = rests.get(key);
      for (const name of rest?.nearly ?? []) issues.push(issue(APPROXIMATION, ob, `modifiers["${name}"]`, `${name} applied before Armature (${rest.vertices[0]} vertices skinned as ${rest.vertices[1]})`));
      for (const name of rest?.driven ?? []) issues.push(issue(APPROXIMATION, ob, `modifiers["${name}"]`, `${name} applied as its drivers set it now`));
      if (dualQuaternions && scaledBones(bones)) issues.push(issue(APPROXIMATION, ob, `modifiers["${modifier.name}"].use_deform_preserve_volume`, 'Preserve Volume of scaled bones: their scale blends linearly'));
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
  // A skeleton that reads each mesh's pose matrix holds the meshes given it once it does.
  if (skin.skeleton.needInitialSkinMatrix && node.skeleton === skin.skeleton) node.skeleton = null;
  node.updatePoseMatrix(skin.pose);
  node.skeleton = skin.skeleton;
  dualQuaternions(node, skin.dualQuaternions);
}
// A mesh skinned with dual quaternions, marked for an export's page (blend-scene.js) to skin it so too.
function dualQuaternions(node, on) {
  useDualQuaternionSkinning(node, on);
  const { bylonderDualQuaternions, ...rest } = node.metadata ?? {};
  node.metadata = on ? { ...rest, bylonderDualQuaternions: true } : Object.keys(rest).length ? rest : null;
}
function removeSkin(node) {
  node.skeleton = null;
  dualQuaternions(node, false);
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
  const [min, max] = posedBox(node, boxes);
  node.setBoundingInfo(new BoundingInfo(min, max));
}
function posedBox(node, boxes, min = Vector3.One().scale(Infinity), max = Vector3.One().scale(-Infinity)) {
  const matrices = node.skeleton.getTransformMatrices(node);
  for (const [bone, [a, b]] of boxes) {
    const m = Matrix.FromArray(matrices, bone * 16);
    for (let k = 0; k < 8; k++) {
      const p = Vector3.TransformCoordinates(new Vector3(k & 1 ? b.x : a.x, k & 2 ? b.y : a.y, k & 4 ? b.z : a.z), m);
      min.minimizeInPlace(p);
      max.maximizeInPlace(p);
    }
  }
  return [min, max];
}

// Each skinned mesh's bounds over every frame of a clip's bone keys (its `animations`), joined into the mesh's
// `metadata.bylonderBounds` ([min, max] in its own space), which a page sets as its bounding box so a character
// animated by clips is culled where it can be, not where its rest pose was.
function clipBounds(mappings, animations, nodeOfKey) {
  const keysOf = new Map(animations.filter(({ animation }) => animation.dataType === Animation.ANIMATIONTYPE_MATRIX).map(({ animation, target }) => [target, animation.getKeys()]));
  for (const mapping of mappings) for (const [key, skin] of mapping.skins) {
    const node = nodeOfKey(key), bones = skin.skeleton.bones;
    if (!node?.skeleton || !bones.some((b) => keysOf.has(b))) continue;
    const boxes = boneBoxes(node, skin), saved = bones.map((b) => b._matrix.clone()), frames = Math.max(...bones.map((b) => keysOf.get(b)?.length ?? 0));
    const [min, max] = (node.metadata?.bylonderBounds ?? [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]).map((v) => Vector3.FromArray(v));
    for (let f = 0; f < frames; f++) {
      bones.forEach((b) => { const keys = keysOf.get(b); if (keys) b._matrix.copyFrom(keys[Math.min(f, keys.length - 1)].value); b.markAsDirty(); });
      skin.skeleton.prepare(true);
      posedBox(node, boxes, min, max);
    }
    bones.forEach((b, i) => { b._matrix.copyFrom(saved[i]); b.markAsDirty(); });
    skin.skeleton.prepare(true);
    node.metadata = { ...node.metadata, bylonderBounds: [min.asArray(), max.asArray()] };
  }
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
    skin.skeleton.useTextureToStoreBoneMatrices = skin.dualQuaternions || (settingsOf(state.mapping.arm)?.use_texture_for_matrices ?? true);
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
      fallbacks: (ob) => [...viewFallbacks(view, byOb.get(address(ob)), ob), ...blenderShapeKeys(ob)],
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

// A mesh whose shape keys Blender blends deforms as Blender in the view: Babylon skins the Mesh before its keys. An
// export blends every mesh's keys on Babylon (shape-keys.js).
const blenderShapeKeys = (ob) => (ob.data.shape_keys && runtimeOf(ob.data.shape_keys) !== 'MAPPED' ? [issue(FALLBACK, ob, 'data.shape_keys', 'shape keys on Blender')] : []);

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
// (Animation.AllowMatricesInterpolation). Without `bake`, an armature drawn by one skeleton is posed by the page where
// it can: its bone constraints run in the page (pose-export.js livePoseConstraints, checked at each frame) and go in
// `constraints`, the bones they move posed from their own location, rotation and scale; a bone whose own pose is its
// F-Curves (live-curves.js livePose, checked at each whole frame) has them in `curves`; each bone still sampled while it
// moves is in `gaps`. `scene`: the nodes (`nodeOf(ob)`, `meshOf(mapping)`, the skinned mesh) the page's constraints read.
// The `bases` mappings' armature bones are keyed by their own location, rotation and scale instead (a clip of a rig whose
// constraints run in the page, which solves them from those). Sampled in the sampling's pass over the frames (sampling.js
// sample): gives a function that returns them once it ran, `deforms`, the names of the meshes the page's native rig
// runtime deforms where its pose runs live, and `live`, the mappings whose constraints the page runs; its result's
// `poses` are the bones' matrices as Blender evaluates them (what bounds read), where they are keyed by their own.
// Names for a report: the first eight, and how many more.
const named = (names) => { const list = [...names]; return `${list.slice(0, 8).join(', ')}${list.length > 8 ? ` and ${list.length - 8} more` : ''}`; };
function poseAnimations(world, mappings, bake, sampling, scene, bases = new Set()) {
  const sync = world.mainSync, { fps, frameStart, frameEnd } = sampling.range, current = world.animation.time.frame;
  const animated = (arm) => !!arm.animation_data || [...arm.pose.bones].some((bone) => bone.constraints.length);
  // The evaluated pose of the bones keyed by their own (`bases`), which bounds read.
  const keys = new Map(), owners = new Map(), stacks = new Map(), evaluated = new Map();
  if (!bake && scene) for (const mapping of mappings) {
    const mesh = mapping.skeletons.size === 1 && scene.meshOf(mapping), [skeleton] = mapping.skeletons.values();
    const stack = mesh && livePoseConstraints(mapping.arm, skeleton, mesh, { nodeOf: scene.nodeOf, deformed: scene.deformed(mapping),
      meshWorld: () => sync.worldMatrix(mesh), nodeWorld: (id) => sync.worldMatrix(world.scene.getNodeById(id)) });
    // A skeleton the page poses is exported, whether or not a mesh skins to it.
    if (stack) { stacks.set(mapping, stack); skeleton.posedByPage = true; }
  }
  const sample = (frame) => {
    for (const mapping of mappings) {
      const bones = bonesOf(mapping.arm, segmentsOf(mapping.arm));
      for (const skeleton of mapping.skeletons.values()) {
        const posed = skeleton.bones.map((bone, i) => relative(bones, i, 'pose', skeleton.space));
        const values = bases.has(mapping) ? posed.map((value, i) => (i < skeleton.armatureBones ? ownMatrix(mapping.arm.pose.bones.get(skeleton.bones[i].name), skeleton.bones[i]) : value)) : posed;
        skeleton.bones.forEach((bone, i) => {
          if (!keys.has(bone)) { keys.set(bone, []); owners.set(bone, mapping); }
          keys.get(bone).push({ frame, value: values[i] });
          if (bases.has(mapping)) (evaluated.get(bone) ?? evaluated.set(bone, []).get(bone)).push({ frame, value: posed[i] });
        });
        stacks.get(mapping)?.check(values, frame);
      }
    }
  };
  if (mappings.some((m) => animated(m.arm)) && frameEnd >= frameStart) sampling.sample(sample);
  else sample(current);
  return Object.assign(once(finish), { deforms: new Set([...stacks.values()].flatMap((stack) => stack.deforms)),
    // The meshes of each mapping skinned by their Armature alone, once its frames are checked.
    skinned: (mapping) => stacks.get(mapping)?.skinned() ?? new Set(),
    // Those it deforms in the end, Babylon's skinning missing them.
    native: (mapping) => { const stack = stacks.get(mapping), skinned = stack?.skinned(); return new Set(stack?.deforms.filter((name) => !skinned.has(name)) ?? []); },
    live: new Set(stacks.keys()) });
  function finish() {
    // A stack the page runs where every bone it moves is posed by its own F-Curves, or not animated.
    const curves = [], gaps = [], constraints = [], posed = new Set();
    for (const [mapping, stack] of stacks) {
      const entity = stack.entity(), own = entity && [...stack.moved].map((bone) => {
        if (drivenPose(mapping.arm, mapping.arm.pose.bones.get(bone.name))) return [];
        const whole = keys.get(bone).map((k, i) => ({ ...k, own: stack.own(bone)[i] })).filter((k) => Number.isInteger(k.frame));
        return livePose(mapping.arm, mapping.arm.pose.bones.get(bone.name), bone, whole.map((k) => k.own), whole[0].frame);
      });
      if (!own || own.some((live) => !live)) {
        for (const name of stack.deforms) report('WARNING', `${name}: deformed as Blender at the frame exported, as ${mapping.arm.name}'s pose does not run live`);
        if (stack.off.size) report('WARNING', `${mapping.arm.name}: the native rig runtime is off from Blender at bones ${named(stack.off)}`);
        continue;
      }
      const skinned = stack.skinned(), mm = (distance) => `${(distance * 1000).toFixed(1)} mm`;
      for (const [name, distance] of stack.deviation) {
        // Babylon's skinning, within the allowance, as plain as it gets.
        if (skinned.has(name) && stack.skinDeviation.get(name) <= stack.allowed.get(name)) continue;
        if (distance <= stack.allowed.get(name)) report('INFO', `${name}: deformed live by the native rig runtime, within ${distance.toPrecision(2)} m of Blender's evaluated mesh`);
        else report('WARNING', `${name}: ${skinned.has(name) ? 'skinned by its Armature alone' : 'deformed by the native rig runtime'}, the closer to Blender's (the runtime ${mm(distance)}, its Armature alone ${Number.isFinite(stack.skinDeviation.get(name)) ? mm(stack.skinDeviation.get(name)) : 'not comparable: its stack changes its vertices'}, ${mm(stack.allowed.get(name))} allowed)`);
      }
      for (const { mesh, lattice, step } of entity.native?.skipped ?? []) report('WARNING', `${mesh}: the native rig runtime does not run ${lattice}'s ${step} modifier, so the lattice deforms it without it`);
      if (stack.off.size) report('WARNING', `${mapping.arm.name}: on the native rig runtime, bones ${named(stack.off)} are off from Blender within what its meshes show`);
      if (stack.unchecked.length) report('WARNING', `${mapping.arm.name}: not vertex-checked against Blender, skinned by Babylon with ${stack.unchecked.map(([name, what]) => `${name} (${what.join(', ')})`).join(', ')}`);
      curves.push(...own.flat());
      constraints.push({ armature: scene.nodeOf(mapping.arm)?.id, pose: entity });
      stack.moved.forEach((bone) => posed.add(bone));
    }
    const animations = [...keys].flatMap(([bone, list]) => {
      if (posed.has(bone)) return [];
      const { arm, skeletons } = owners.get(bone);
      // The page's drivers pose it.
      if (!bake && !isJoint(bone) && skeletons.size === 1 && drivenPose(arm, arm.pose.bones.get(bone.name))) return [];
      const whole = list.filter((k) => Number.isInteger(k.frame));
      const live = !bake && !isJoint(bone) && skeletons.size === 1 && livePose(arm, arm.pose.bones.get(bone.name), bone, whole.map((k) => k.value), whole[0].frame);
      if (live) curves.push(...live);
      if (live?.length) return [];
      const moves = list.some((k) => !k.value.equalsWithEpsilon(list[0].value, 1e-6));
      if (!bake && moves) gaps.push({ message: `${arm.name} ${bone.name}: its pose is not its F-Curves alone (constraints the page does not run, NLA, drivers, inheritance, several skeletons) or the unit misses Main` });
      const animation = new Animation(`${bone.id} pose`, BONE_MATRIX, fps, Animation.ANIMATIONTYPE_MATRIX, Animation.ANIMATIONLOOPMODE_CYCLE);
      const keeps = moves && sampling.keeps(arm.name);
      animation.setKeys(moves ? list.filter(({ frame }) => keeps(frame)) : list.slice(0, 1));
      return [{ animation, target: bone }];
    });
    // What each bone's matrix is over the frames, as bounds read it: the pose Blender evaluates.
    const poses = animations.map(({ animation, target }) => (evaluated.has(target) ? { animation: { dataType: Animation.ANIMATIONTYPE_MATRIX, getKeys: () => evaluated.get(target) }, target } : { animation, target }));
    return { animations, curves, gaps, constraints, poses };
  }
}
const once = (make) => { let made; return () => (made ??= make()); };

// An object parented to a bone of a mapped armature, as the page hangs it from that bone (attachToBone): the bone of
// the skeleton skinning a mesh, that mesh's node, and the bone's world matrix at the frame Main is on.
function boneParent(mappings, ob, byOb) {
  const mapping = ob.parent_type === 'BONE' && mappings.find((m) => address(m.arm) === address(ob.parent));
  for (const [key, skin] of mapping ? mapping.skins : []) {
    const bone = skin.skeleton.bones.find((b) => b.name === ob.parent_bone), mesh = byOb.get(key)?.node;
    if (bone && mesh) return { bone, mesh, world: matrix(mapping.arm.pose.bones.get(bone.name).matrix).multiply(matrix(mapping.arm.matrix_world)) };
  }
  return null;
}

// Export: every armature mapped that skins a mesh the export writes (all of the scene's, or of its selected objects:
// `world.only`), those on Blender for the export's duration (their meshes skinned, then drawn as Blender evaluated them
// again), with their issues and their pose's animation.
function exportArmatures(world, { bake, sampling, rests = appliedRests() }) {
  const view = lastView;
  if (!view || !world.mainSync) return { reports: [], animations: [], restore() {} };
  const entries = [...view.entries()], meshes = entries.filter((e) => e.type === 'MESH').map((e) => idStruct(e.ob)), byOb = new Map(entries.map((e) => [e.ob, e]));
  const exported = (mapping) => !world.only || [...mapping.skins.keys()].some((key) => world.only.has(byOb.get(key)?.node));
  const temporary = [], mappings = [], meshOf = (key) => view.blender.mesh(rests.byAddress(key)?.address ?? key);
  for (const arm of entries.filter((e) => e.type === 'ARMATURE').map((e) => idStruct(e.ob))) {
    const live = mapped.get(address(arm));
    if (live) { if (exported(live.mapping)) mappings.push(live.mapping); continue; }
    const state = { mapping: mapArmature(arm, view.scene), applied: new Map(), options: { objects: meshes, meshOf, influencers: settingsOf(arm)?.influencers,
      restOf: rests.of, fallbacks: (ob) => viewFallbacks(view, byOb.get(address(ob)), ob) } };
    state.mapping.update(state.options);
    if (!state.mapping.skins.size || !exported(state.mapping)) { state.mapping.dispose(); continue; }
    temporary.push(state);
    mappings.push(state.mapping);
  }
  const nodeOf = (ob) => byOb.get(address(ob))?.node;
  // The meshes the native runtime may deform for a mapping: those Babylon cannot skin for their stack, and those whose
  // Surface Deform reads a mesh the armature deforms, with the meshes those read (`source`).
  const entryOf = (ob, source = false) => { const key = address(ob), node = byOb.get(key)?.node;
    return node ? [{ ob, node, source, mesh: () => view.blender.mesh(key), evaluated: () => view.blender.evaluatedMesh(key) }] : []; };
  const surfaceTargets = (ob) => [...ob.modifiers].filter((m) => m.type === 'SURFACE_DEFORM' && m.show_viewport && m.target).map((m) => m.target);
  const deformed = (m) => {
    const ofArmature = (ob) => m.skins.has(address(ob)) || m.apart.has(address(ob));
    const surface = meshes.filter((ob) => !m.apart.has(address(ob)) && surfaceTargets(ob).some(ofArmature));
    const read = [...new Set([...m.apart.values(), ...surface].flatMap(surfaceTargets))].filter((ob) => !m.apart.has(address(ob)));
    // The meshes Babylon skins too, each checked: the runtime deforms one Babylon's skinning misses (`skinnable`).
    const skinnable = [...m.skins.keys()].flatMap((key) => entryOf(idStruct(byOb.get(key).ob)).map((entry) => ({ ...entry, skinnable: true, skin: () => m.skins.get(key), rest: () => meshOf(key) })));
    return [...[...m.apart.values(), ...surface].flatMap((ob) => entryOf(ob)), ...skinnable, ...read.flatMap((ob) => entryOf(ob, true))];
  };
  const posed = poseAnimations(world, mappings, bake, sampling, { nodeOf, deformed, meshOf: (m) => byOb.get(m.skins.keys().next().value)?.node });
  // The meshes of an export's mapping Babylon cannot skin for their stack that the native runtime does not deform
  // either: skinned by their Armature with their other modifiers applied to their rest (settle), so none stands still.
  const unmoved = (m) => (temporary.some((state) => state.mapping === m) ? [...m.apart.values()].filter((ob) => !posed.deforms.has(ob.name)).map((ob) => ob.name) : []);
  // A mesh the native runtime deforms, or one skinned for it, is no longer Blender's, whatever its stack.
  const native = (m, issues) => {
    const skinned = new Set(unmoved(m)), runtime = posed.native(m), apart = new Set([...m.apart.values()].map((ob) => ob.name));
    const moved = (name) => runtime.has(name) || skinned.has(name) || (apart.has(name) && posed.deforms.has(name));
    return [...issues.filter((i) => i.kind !== FALLBACK || !moved(i.ob)),
      ...[...new Set(issues.map((i) => i.ob))].filter(moved).map((name) => issue(APPROXIMATION, { name }, 'modifiers',
        skinned.has(name) ? 'skinned by its Armature, its other modifiers applied to its rest, as the native rig runtime does not deform it' : 'its modifiers deform on the native rig runtime'))];
  };
  for (const state of temporary) {
    drawSkins({ ...view, world: { animation: { playing: true } } }, state, meshOf);
    for (const key of state.applied.keys()) exporting.add(key);
  }
  return {
    reports: mappings.map((m) => ({ title: `${m.arm.name}: exported`, issues: native(m, [...m.issues.filter((i) => !i.silent)]) })),
    get animations() { return posed().animations; },
    get curves() { return posed().curves; },
    get gaps() { return posed().gaps; },
    get constraints() { return posed().constraints; },
    clip(clipSampling, owns) {
      const owned = mappings.filter((m) => owns(m.arm)), clipPosed = poseAnimations(world, owned, true, clipSampling, null, posed.live);
      return once(() => {
        const { animations, poses } = clipPosed();
        clipBounds(owned, poses, (key) => byOb.get(key)?.node);
        return animations;
      });
    },
    boneParent: (ob) => boneParent(mappings, ob, byOb),
    // Once the frames are checked: the meshes the native rig runtime deforms further from Blender than their Armature
    // alone are skinned, before the scene is written; so are those it does not deform, which would otherwise stand still,
    // with every modifier of theirs applied into the rest they skin.
    settle() {
      for (const state of temporary) {
        const still = unmoved(state.mapping), skinned = new Set([...posed.skinned(state.mapping), ...still]), native = posed.native(state.mapping);
        if (!skinned.size && !native.size) continue;
        for (const ob of state.mapping.apart.values()) if (still.includes(ob.name)) rests.force(ob);
        state.mapping.update({ ...state.options, skinned, native });
        drawSkins({ ...view, world: { animation: { playing: true } } }, state, meshOf);
      }
    },
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
    use_dual_quaternions: props.BoolProperty(kw({ name: 'Dual Quaternion Skinning', description: "Meshes whose Armature modifier preserves volume skin with dual quaternions, as Blender's Preserve Volume; off, they skin linearly",
      default: true, options: new Set() })),
    use_bbone_segments: props.BoolProperty(kw({ name: 'B-Bone Segments as Bones', description: "A deforming B-Bone's segment joints as bones of the skeleton, so it bends as Blender's; off, it deforms as one segment",
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
