import { Mesh, TransformNode, VertexData } from "@babylonjs/core";
import { nodeId, identify } from "../object/identity.js";
import { buildMesh, rebuildMesh } from "../object/mesh-catalog.js";
export const snapshot = (objects) =>
  objects.map((m) => ({
    id: nodeId(m),
    name: m.name,
    kind: m.metadata?.group
      ? "group"
      : m instanceof Mesh
        ? "mesh"
        : "transform",
    parent: objects.includes(m.parent) ? nodeId(m.parent) : null,
    p: m.position.asArray(),
    r: (m.rotationQuaternion
      ? m.rotationQuaternion.toEulerAngles()
      : m.rotation
    ).asArray(),
    s: m.scaling.asArray(),
    enabled: m.isEnabled(false),
    pickable: m.isPickable !== false,
    deleted: !!m.metadata?.wbDeleted,
    locked: !!m.metadata?.wbLocked,
    ...(m.metadata?.wbHideRender ? { hideRender: true } : {}),
    ...(m.metadata?.wbModifiers ? {modifiers:structuredClone(m.metadata.wbModifiers)} : {}),
    ...(m.metadata?.wbParticles ? {particles:structuredClone(m.metadata.wbParticles)} : {}),
    ...(m.metadata?.wbModifierBase ? {modifierBase:structuredClone(m.metadata.wbModifierBase)} : {}),
    ...(m.metadata?.wbTransformLocks ? {transformLocks:{...m.metadata.wbTransformLocks}} : {}),
    ...(m.metadata?.wbCurve ? {curve:structuredClone(m.metadata.wbCurve)} : {}),
    ...(m.metadata?.wbCreation ? { creation: m.metadata.wbCreation } : {}),
  }));
export function apply(objects, data, { partial = false } = {}) {
  if (!Array.isArray(data) || data.length > 10000) return;
  const rows = data.filter(
    (row) =>
      row &&
      typeof row.id === "string" &&
      ["p", "r", "s"].every(
        (k) =>
          Array.isArray(row[k]) &&
          row[k].length === 3 &&
          row[k].every((v) => Number.isFinite(v) && Math.abs(v) < 1e6),
      ) &&
      row.s.every((v) => v > 0),
  );
  const scene = objects.scene || objects[0]?.getScene();
  if (!scene) return;
  if (!partial)
    for (const node of objects)
      if (!rows.some((row) => row.id === nodeId(node))) {
        node.metadata = { ...node.metadata, wbDeleted: true };
        node.setEnabled(false);
      }
  for (const row of rows) {
    let node = objects.find((n) => nodeId(n) === row.id);
    if (!node) {
      if (row.kind === "group" || row.kind === "transform")
        node = new TransformNode(row.name || row.id, scene);
      else if (row.creation?.builder || row.creation?.operator || row.creation?.mesh || row.creation?.curve || row.creation?.armature)
        node = buildMesh(scene, row.name || row.id, row.creation);
      else if (row.creation?.vertices) {
        node = new Mesh(row.name || row.id, scene);
        VertexData.Parse(row.creation.vertices).applyToMesh(node);
        node.material = scene.getMaterialByName(row.creation.material) || null;
      }
      if (node) {
        node.metadata = {
          editable: true,
          wbId: row.id,
          group: row.kind === "group",
          wbCreation: row.creation,
        };
        objects.push(node);
      }
    } else if (
      (row.creation?.builder || row.creation?.operator || row.creation?.mesh || row.creation?.curve || row.creation?.armature) &&
      JSON.stringify(row.creation) !== JSON.stringify(node.metadata?.wbCreation)
    )
      rebuildMesh(node, row.creation);
    else if (node && row.creation?.vertices && JSON.stringify(row.creation) !== JSON.stringify(node.metadata?.wbCreation)) {
      node.makeGeometryUnique();
      VertexData.Parse(row.creation.vertices).applyToMesh(node);
      node.metadata = {...node.metadata, wbCreation: row.creation};
    }
  }
  const byId = new Map(objects.map((n) => [nodeId(n), n]));
  for (const row of rows) {
    const node = byId.get(row.id);
    if (node) node.parent = null;
  }
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    const parent = byId.get(row.parent);
    if (parent && parent !== node && !parent.isDescendantOf(node))
      node.parent = parent;
    node.metadata = {
      ...node.metadata,
      wbId: row.id,
      group: row.kind === "group",
      wbDeleted: !!row.deleted,
      wbLocked: !!row.locked,
      wbHideRender: !!row.hideRender,
      wbCreation: row.creation ? structuredClone(row.creation) : undefined,
      wbModifiers: row.modifiers ? structuredClone(row.modifiers) : undefined,
      wbParticles: row.particles ? structuredClone(row.particles) : undefined,
      wbModifierBase: row.modifierBase ? structuredClone(row.modifierBase) : undefined,
      wbTransformLocks: row.transformLocks ? {...row.transformLocks} : undefined,
      wbCurve: row.curve ? structuredClone(row.curve) : undefined,
    };
    node.name = row.name || row.id;
    node.rotationQuaternion = null;
    node.position.copyFromFloats(...row.p);
    node.rotation.copyFromFloats(...row.r);
    node.scaling.copyFromFloats(...row.s);
    node.setEnabled(!row.deleted && row.enabled !== false);
    if ("isPickable" in node)
      node.isPickable = row.pickable !== false && !row.locked;
  }
}
// What Babylon owns of each object, which Main does not hold (docs/model.md): its Babylon-built geometry's recipe,
// particles, Bylonder's modifier stack and its base geometry, transform locks and SDK curve paths. Main's undo carries
// the rest.
const NATIVE = { group: 'group', particles: 'wbParticles', modifierBase: 'wbModifierBase', modifiers: 'wbModifiers', transformLocks: 'wbTransformLocks', curve: 'wbCurve' };
const babylonBuilt = (creation) => !!(creation?.builder || creation?.vertices);
export const nativeSnapshot = (objects) => objects.map((node) => ({
  id: nodeId(node),
  ...Object.fromEntries(Object.entries(NATIVE).filter(([, field]) => node.metadata?.[field] !== undefined).map(([key, field]) => [key, structuredClone(node.metadata[field])])),
  ...(babylonBuilt(node.metadata?.wbCreation) ? { creation: node.metadata.wbCreation } : {}),
}));
export function applyNative(objects, rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const node of objects) {
    const row = byId.get(nodeId(node));
    if (!row) continue;
    const metadata = { ...node.metadata };
    for (const [key, field] of Object.entries(NATIVE)) metadata[field] = row[key] === undefined ? undefined : structuredClone(row[key]);
    node.metadata = metadata;
    if (row.creation && JSON.stringify(row.creation) !== JSON.stringify(node.metadata.wbCreation)) {
      if (row.creation.builder) rebuildMesh(node, row.creation);
      else {
        node.makeGeometryUnique();
        VertexData.Parse(row.creation.vertices).applyToMesh(node);
        node.metadata = { ...node.metadata, wbCreation: row.creation };
      }
    }
  }
}

// One undo history (docs/model.md): each step is a step of Blender's undo stack, Main's state (main-sync.js undoPush,
// undo-api.cc), with what Babylon owns at that moment: its objects' native data and the extras' capture. Undo and redo
// load Blender's step, which the view draws, then restore Babylon's.
//   main: the scene sync; extras: capture() and restore(state) of other Babylon-owned state, beforeCommit().
export function createHistory(objects, onChange, { main, capture = () => null, restore = () => {}, beforeCommit = () => {} } = {}) {
  main.undoInit();
  const take = (name) => ({ step: main.undoPush(name), objects: nativeSnapshot(objects), extra: capture() });
  const unchanged = (a, b) => a.step === b.step && JSON.stringify([a.objects, a.extra]) === JSON.stringify([b.objects, b.extra]);
  let entries = [take('Original')],
    index = 0,
    revision = 0;
  const load = (entry) => {
    if (!main.undoLoad(entry.step)) return false;
    applyNative(objects, entry.objects);
    restore(entry.extra);
    return true;
  };
  return {
    get revision() {
      return revision;
    },
    commit(name = 'Edit') {
      beforeCommit();
      const next = take(name);
      if (unchanged(next, entries[index])) return;
      entries = entries.slice(0, index + 1);
      entries.push(next);
      if (entries.length > 100) entries.shift();
      index = entries.length - 1;
      revision++;
      onChange();
    },
    // Replaces the latest step, for an operator re-run from the redo panel.
    amend(name = 'Edit') {
      beforeCommit();
      entries[index] = take(name);
      revision++;
      onChange();
    },
    undo() {
      if (index > 0 && load(entries[index - 1])) {
        index--;
        revision++;
        onChange();
      }
    },
    redo() {
      if (index < entries.length - 1 && load(entries[index + 1])) {
        index++;
        revision++;
        onChange();
      }
    },
  };
}
