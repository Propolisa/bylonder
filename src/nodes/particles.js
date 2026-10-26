import { NodeParticleSystemSet } from '@babylonjs/core';
import { deleted } from '../editors/object/identity.js';
import { bindGraph } from './bindings.js';

export function createParticles(world, { commit = () => {}, notify = console.warn } = {}) {
  const { scene, animation } = world;
  const live = new Map();
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const systems = node => node?.metadata?.wbParticles || [];
  const owner = id => world.objects.find(n => systems(n).some(s => s.id === id));
  const gather = (block, found = new Set()) => {
    if (!block || found.has(block)) return found;
    found.add(block);
    for (const input of block.inputs) gather(input.connectedPoint?.ownerBlock, found);
    return found;
  };
  const defaultGraph = () => {
    const set = new NodeParticleSystemSet('Particles');
    set.setToDefault();
    set.attachedBlocks.push(...set.systemBlocks.reduce((found, root) => gather(root, found), new Set()));
    const json = set.serialize();
    set.dispose();
    return json;
  };

  const realize = async (node, entry) => {
    let item = live.get(entry.id);
    const json = JSON.stringify(entry.graph);
    if (item?.json === json && item.node === node && item.enabled === entry.enabled) return;
    item?.runtime?.dispose();
    if (!item || item.json !== json) {
      item?.set?.dispose();
      const set = new NodeParticleSystemSet(entry.name);
      set.parseSerializedObject(entry.graph);
      set.onBuildObservable.add(() => { if (!item.building) api.store(entry.id); });
      item = { set, json, node };
      live.set(entry.id, item);
    }
    item.node = node;
    item.enabled = entry.enabled;
    if (!entry.enabled) return;
    item.building = true;
    try {
      item.runtime = await item.set.buildAsync(scene);
      item.runtime.start(node);
      bindGraph(animation, { id: 'particles:' + entry.id, title: node.name + ' › ' + entry.name, graph: () => live.get(entry.id)?.set, kind: 'particles' });
    } catch (error) { notify('Particles: ' + error.message); }
    finally { item.building = false; }
  };

  const api = {
    systems,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    graph: id => live.get(id)?.set || null,
    active: node => systems(node)[Math.min(node.metadata?.wbActiveParticles || 0, systems(node).length - 1)] || null,
    setActive(node, index) { node.metadata = { ...node.metadata, wbActiveParticles: index }; emit(); },
    add(node) {
      const list = systems(node), used = list.map(s => s.name);
      let name = 'ParticleSystem', n = 1;
      while (used.includes(name)) name = 'ParticleSystem.' + String(n++).padStart(3, '0');
      const entry = { id: crypto.randomUUID(), name, enabled: true, graph: defaultGraph() };
      node.metadata = { ...node.metadata, wbParticles: [...list, entry], wbActiveParticles: list.length };
      api.refresh(); commit(); emit();
      return entry;
    },
    remove(node, id) {
      node.metadata = { ...node.metadata, wbParticles: systems(node).filter(s => s.id !== id) };
      api.refresh(); commit(); emit();
    },
    update(node, id, patch) {
      node.metadata = { ...node.metadata, wbParticles: systems(node).map(s => (s.id === id ? { ...s, ...patch } : s)) };
      api.refresh(); commit(); emit();
    },
    store(id) {
      const node = owner(id), item = live.get(id);
      if (!node || !item) return;
      const graph = item.set.serialize();
      item.json = JSON.stringify(graph);
      node.metadata = { ...node.metadata, wbParticles: systems(node).map(s => (s.id === id ? { ...s, graph } : s)) };
      commit(); emit();
      item.runtime?.dispose();
      item.runtime = null;
      item.enabled = undefined;
      api.refresh();
    },
    refresh() {
      const present = new Set();
      for (const node of world.objects) {
        if (node.isDisposed() || deleted(node)) continue;
        for (const entry of systems(node)) { present.add(entry.id); realize(node, entry); }
      }
      for (const [id, item] of live) if (!present.has(id)) { item.runtime?.dispose(); item.set?.dispose(); live.delete(id); }
    },
    dispose() { for (const item of live.values()) { item.runtime?.dispose(); item.set?.dispose(); } live.clear(); listeners.clear(); },
  };
  return api;
}
