import { Color3, Material, MultiMaterial, NodeMaterial, PBRMaterial, StandardMaterial, Texture } from '@babylonjs/core';
import { blenderDefaultTree, buildMaterial } from '../../nodes/blender/shader-nodes.js';
import { nodeId, deleted } from '../../editors/object/identity.js';
import { fields, materialType, materialTypes, resolve, textureSlots } from './schema.js';
import { bindGraph } from '../../nodes/bindings.js';

export const materialId = material => material.metadata?.wbId || material.name;
const imageFile = /\.(png|jpe?g|webp|gif|bmp|ktx2?|dds|env|hdr)$/i;

// What an object without a material shows: Blender's default surface (material_default_surface_init), a Principled
// BSDF of base color 0.8 at the Principled's defaults, so it takes lights as Blender's materials do.
function defaultSurface(scene) {
  const material = new PBRMaterial('__defaultSurface', scene);
  material.albedoColor = new Color3(0.8, 0.8, 0.8);
  material.metallic = 0;
  material.roughness = 0.5;
  material.indexOfRefraction = 1.5;
  return material;
}

export function createMaterialLibrary(world, { commit = () => {}, asset = path => path, files = [] } = {}) {
  const { scene, animation } = world;
  scene.defaultMaterial = defaultSurface(scene);
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const internal = m => !m || m.name.startsWith('__') || m === scene._defaultMaterial || m instanceof MultiMaterial;
  const all = () => scene.materials.filter(m => !internal(m) && !m.metadata?.wbRemoved);
  const byId = id => all().find(m => materialId(m) === id) || null;
  const meshes = () => world.objects.filter(n => n.getTotalVertices && !deleted(n) && !n.isDisposed());
  const slots = mesh => mesh.material instanceof MultiMaterial ? [...mesh.material.subMaterials] : mesh.material ? [mesh.material] : Array(mesh.metadata?.wbSlotCount || 0).fill(null);
  const users = material => meshes().reduce((n, mesh) => n + slots(mesh).filter(m => m === material).length, 0) + (material.metadata?.wbFakeUser ? 1 : 0);
  const unique = (name, except) => {
    const taken = new Set(all().filter(m => m !== except).map(m => m.name));
    if (!taken.has(name)) return name;
    const stem = name.replace(/\.\d{3}$/, '');
    for (let i = 1; ; i++) { const next = stem + '.' + String(i).padStart(3, '0'); if (!taken.has(next)) return next; }
  };
  const stripped = material => { const json = material.serialize(); for (const slot of textureSlots) delete json[slot]; return json; };
  const tag = (material, extra = {}) => { material.metadata = { ...material.metadata, wbId: crypto.randomUUID(), wbCreated: true, ...extra }; return material; };

  const setSlots = (mesh, list) => {
    const old = mesh.material instanceof MultiMaterial ? mesh.material : null;
    mesh.metadata = { ...mesh.metadata, wbSlotCount: list.length };
    if (list.length <= 1) { mesh.material = list[0] || null; old?.dispose(false, false); return; }
    const multi = old || new MultiMaterial('__slots ' + nodeId(mesh), scene);
    multi.subMaterials = list;
    mesh.material = multi;
  };
  const active = mesh => Math.min(mesh.metadata?.wbActiveSlot || 0, Math.max(0, slots(mesh).length - 1));
  const register = material => {
    const id = materialId(material), type = materialType(material);
    for (const field of fields(type)) {
      if (field.animatable === false) continue;
      const read = () => { const { owner, key } = resolve(material, field.path); return owner?.[key]; };
      const value = read();
      const paths = field.color ? ['r', 'g', 'b'].map(c => [field.path + '.' + c, field.label + ' ' + c.toUpperCase()]) : [[field.path, field.label]];
      if (value === undefined || value === null) continue;
      for (const [path, label] of paths) animation.register({
        id: 'material:' + id, path, label, group: material.name, options: field.options, owner: () => world.mainSync?.materialOf(material),
        available: () => !material.isDisposed?.() && !material.metadata?.wbRemoved && scene.materials.includes(material),
        get: () => { const { owner, key } = resolve(material, path); return owner?.[key]; },
        set: v => { const { owner, key } = resolve(material, path); if (owner) owner[key] = v; },
      });
    }
  };
  const sync = () => {
    for (const material of all()) {
      register(material);
      if (materialType(material) === 'node') bindGraph(animation, { id: 'material:' + materialId(material) + ':graph', title: material.name, graph: material, kind: 'material', owner: () => world.mainSync?.materialOf(material) });
    }
    emit();
  };
  const changed = () => { sync(); commit(); };

  const create = (type = 'pbr', name) => {
    let material;
    const label = unique(name || 'Material');
    if (type === 'node') { material = new NodeMaterial(label, scene); blenderDefaultTree(material); buildMaterial(material); }
    else if (type === 'standard') material = new StandardMaterial(label, scene);
    else { material = new PBRMaterial(label, scene); material.metallic = 0; material.roughness = 0.5; material.albedoColor = new Color3(0.8, 0.8, 0.8); }
    return tag(material);
  };
  const copyCommon = (from, to) => {
    const color = materialType(from) === 'pbr' ? from.albedoColor : from.diffuseColor;
    if (color) {
      if (materialType(to) === 'pbr') to.albedoColor = color.clone();
      else if (materialType(to) === 'standard') to.diffuseColor = color.clone();
    }
    for (const key of ['alpha', 'backFaceCulling', 'wireframe', 'transparencyMode', 'alphaCutOff']) if (from[key] !== undefined && to[key] !== undefined) to[key] = from[key];
    if (from.emissiveColor && to.emissiveColor) to.emissiveColor = from.emissiveColor.clone();
    const texture = from.albedoTexture || from.diffuseTexture;
    if (texture) to[materialType(to) === 'pbr' ? 'albedoTexture' : 'diffuseTexture'] = texture;
    if (from.bumpTexture && 'bumpTexture' in to) to.bumpTexture = from.bumpTexture;
  };
  const replace = (from, to) => {
    for (const mesh of meshes()) { const list = slots(mesh); if (list.includes(from)) setSlots(mesh, list.map(m => (m === from ? to : m))); }
  };

  const api = {
    all, byId, slots, users, active, type: materialType, types: materialTypes,
    images: () => files.filter(f => imageFile.test(f)),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    sync,
    setActive(mesh, index) { mesh.metadata = { ...mesh.metadata, wbActiveSlot: index }; emit(); },
    activeMaterial(mesh) { return mesh ? slots(mesh)[active(mesh)] || null : null; },
    addSlot(mesh) { const list = slots(mesh); setSlots(mesh, [...list, null]); api.setActive(mesh, list.length); changed(); },
    removeSlot(mesh, index = active(mesh)) { const list = slots(mesh); if (!list.length) return; list.splice(index, 1); setSlots(mesh, list); api.setActive(mesh, Math.max(0, index - 1)); changed(); },
    moveSlot(mesh, index, delta) { const list = slots(mesh), to = index + delta; if (to < 0 || to >= list.length) return; [list[index], list[to]] = [list[to], list[index]]; setSlots(mesh, list); api.setActive(mesh, to); changed(); },
    removeUnusedSlots(mesh) { const list = slots(mesh).filter(Boolean); setSlots(mesh, list); api.setActive(mesh, 0); changed(); },
    assign(mesh, index, material) { const list = slots(mesh); if (!list.length) list.push(null); list[index] = material; setSlots(mesh, list); changed(); },
    newMaterial(mesh, index = active(mesh), type = 'pbr') {
      const current = slots(mesh)[index];
      const material = current ? api.duplicate(current, false) : create(type);
      api.assign(mesh, index, material);
      return material;
    },
    create(type, name) { const material = create(type, name); changed(); return material; },
    duplicate(material, notify = true) {
      const copy = material.clone(unique(material.name));
      tag(copy, { wbTextures: { ...material.metadata?.wbTextures } });
      if (notify) changed();
      return copy;
    },
    makeSingleUser(mesh, index = active(mesh)) { const material = slots(mesh)[index]; if (material && users(material) > 1) api.assign(mesh, index, api.duplicate(material, false)); },
    unlink(mesh, index = active(mesh)) { api.assign(mesh, index, null); },
    rename(material, name) { if (!name?.trim()) return; material.name = unique(name.trim(), material); changed(); },
    toggleFakeUser(material) { material.metadata = { ...material.metadata, wbFakeUser: !material.metadata?.wbFakeUser }; changed(); },
    remove(material) {
      replace(material, null);
      if (material.metadata?.wbCreated) material.dispose(false, false);
      else material.metadata = { ...material.metadata, wbRemoved: true };
      changed();
    },
    purge() { const orphans = all().filter(m => !users(m)); orphans.forEach(m => api.remove(m)); return orphans.length; },
    convert(material, type) {
      if (materialType(material) === type) return material;
      const next = create(type, material.name + '~');
      copyCommon(material, next);
      next.name = material.name;
      next.metadata = { ...next.metadata, wbId: materialId(material), wbCreated: true, wbFakeUser: material.metadata?.wbFakeUser, wbTextures: material.metadata?.wbTextures };
      replace(material, next);
      if (material.metadata?.wbCreated) material.dispose(false, false);
      else { material.metadata = { ...material.metadata, wbRemoved: true, wbId: materialId(material) + '#replaced' }; }
      changed();
      return next;
    },
    setTexture(material, slot, path) {
      material[slot]?.metadata?.wbAsset && material[slot].dispose();
      material[slot] = path ? Object.assign(new Texture(asset(path), scene), { metadata: { wbAsset: path }, name: path }) : null;
      if (slot === 'metallicTexture' && path) Object.assign(material, { useRoughnessFromMetallicTextureGreen: true, useMetallnessFromMetallicTextureBlue: true, useRoughnessFromMetallicTextureAlpha: false });
      material.metadata = { ...material.metadata, wbTextures: { ...material.metadata?.wbTextures, [slot]: path || null } };
      changed();
    },
    markGraphEdited(material) { material.metadata = { ...material.metadata, wbGraphEdited: true }; changed(); },

    capture({ save = false } = {}) {
      const state = { created: [], names: {}, graphs: {}, slots: {}, fake: [], textures: {}, removed: [] };
      for (const material of scene.materials) {
        if (internal(material)) continue;
        const id = materialId(material);
        if (material.metadata?.wbRemoved) { if (!material.metadata?.wbCreated) state.removed.push(id.replace(/#replaced$/, '')); continue; }
        if (material.metadata?.wbCreated) {
          if (save && !users(material)) continue;
          state.created.push({ id, json: stripped(material) });
        } else {
          if (baseline.names[id] !== undefined && baseline.names[id] !== material.name) state.names[id] = material.name;
          if (material.metadata?.wbGraphEdited) state.graphs[id] = material.serialize();
        }
        if (material.metadata?.wbFakeUser) state.fake.push(id);
        if (material.metadata?.wbTextures && Object.keys(material.metadata.wbTextures).length) state.textures[id] = { ...material.metadata.wbTextures };
      }
      for (const mesh of meshes()) {
        const ids = slots(mesh).map(m => (m ? materialId(m) : null));
        if (JSON.stringify(ids) !== JSON.stringify(baseline.slots[nodeId(mesh)] || [])) state.slots[nodeId(mesh)] = ids;
      }
      return state;
    },
    apply(state = {}) {
      const keep = new Set((state.created || []).map(c => c.id));
      for (const material of [...scene.materials]) if (material.metadata?.wbCreated && !internal(material) && !keep.has(materialId(material))) { replace(material, null); material.dispose(false, false); }
      for (const material of scene.materials) if (!internal(material) && !material.metadata?.wbCreated) {
        const id = materialId(material).replace(/#replaced$/, '');
        for (const slot of Object.keys(material.metadata?.wbTextures || {})) material[slot] = baseline.textures[id]?.[slot] ?? null;
        material.metadata = { ...material.metadata, wbId: id, wbRemoved: (state.removed || []).includes(id) || undefined, wbTextures: undefined, wbFakeUser: undefined };
        if (baseline.names[id] !== undefined) material.name = state.names?.[id] ?? baseline.names[id];
      }
      for (const { id, json } of state.created || []) {
        let material = byId(id);
        if (material?.metadata?.wbCreated && JSON.stringify(stripped(material)) === JSON.stringify(json)) continue;
        if (material?.metadata?.wbCreated) { replace(material, null); material.dispose(false, false); }
        material = Material.Parse(json, scene, '');
        if (material) material.metadata = { ...material.metadata, wbId: id, wbCreated: true };
      }
      for (const [id, json] of Object.entries(state.graphs || {})) {
        const material = byId(id);
        if (material instanceof NodeMaterial) { material.parseSerializedObject(json); buildMaterial(material); material.metadata = { ...material.metadata, wbGraphEdited: true }; }
      }
      for (const id of state.fake || []) { const m = byId(id); if (m) m.metadata = { ...m.metadata, wbFakeUser: true }; }
      for (const [id, map] of Object.entries(state.textures || {})) {
        const material = byId(id);
        if (!material) continue;
        for (const [slot, path] of Object.entries(map)) material[slot] = path ? Object.assign(new Texture(asset(path), scene), { metadata: { wbAsset: path }, name: path }) : null;
        material.metadata = { ...material.metadata, wbTextures: { ...map } };
      }
      for (const mesh of meshes()) {
        const ids = state.slots?.[nodeId(mesh)] ?? baseline.slots[nodeId(mesh)];
        if (ids) setSlots(mesh, ids.map(id => (id ? byId(id) : null)));
      }
      sync();
    },
  };

  for (const material of all()) material.metadata = { ...material.metadata, wbId: materialId(material) };
  const baseline = {
    names: Object.fromEntries(all().map(m => [materialId(m), m.name])),
    textures: Object.fromEntries(all().map(m => [materialId(m), Object.fromEntries(textureSlots.filter(slot => m[slot]).map(slot => [slot, m[slot]]))])),
    slots: Object.fromEntries(meshes().map(mesh => [nodeId(mesh), slots(mesh).map(m => (m ? materialId(m) : null))])),
  };
  sync();
  return api;
}
