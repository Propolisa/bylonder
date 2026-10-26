import { Mesh, TransformNode, VertexData } from "@babylonjs/core";
import { nodeId, identify } from "../object/identity.js";
import { buildMesh, rebuildMesh } from "../object/mesh-catalog.js";
const KEY = "babylon-workbench:transforms:v1";
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
      else if (row.creation?.builder)
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
      row.creation?.builder &&
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
export function createStorage(objects, notify) {
  let enabled = false;
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if ([1, 2, 3].includes(value?.version)) {
      apply(objects, value.objects);
      enabled = true;
    }
  } catch {
    notify("Saved transforms unavailable; using defaults.");
  }
  return {
    get enabled() {
      return enabled;
    },
    save() {
      if (!enabled) return;
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ version: 3, objects: snapshot(objects) }),
        );
      } catch {
        enabled = false;
        notify("Browser storage unavailable. Changes remain in this session.");
      }
    },
    set(value) {
      enabled = value;
      if (value) this.save();
      else
        try {
          localStorage.removeItem(KEY);
        } catch {
          notify("Could not remove saved transforms.");
        }
    },
    clear() {
      try {
        localStorage.removeItem(KEY);
        enabled = false;
      } catch {
        notify("Could not clear browser storage.");
      }
    },
  };
}
export function createHistory(objects, onChange, extras = {}) {
  const capture = () => ({objects:snapshot(objects), extra:extras.capture?.()});
  const restore = entry => {apply(objects,entry.objects);extras.restore?.(entry.extra);};
  let entries = [capture()],
    index = 0,
    revision = 0;
  return {
    get revision() {
      return revision;
    },
    commit() {
      extras.beforeCommit?.();
      const next = capture();
      if (JSON.stringify(next) === JSON.stringify(entries[index])) return;
      entries = entries.slice(0, index + 1);
      entries.push(next);
      if (entries.length > 100) entries.shift();
      index = entries.length - 1;
      revision++;
      onChange();
    },
    undo() {
      if (index > 0) {
        restore(entries[--index]);
        revision++;
        onChange();
      }
    },
    redo() {
      if (index < entries.length - 1) {
        restore(entries[++index]);
        revision++;
        onChange();
      }
    },
  };
}
