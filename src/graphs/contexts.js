import { NodeMaterial } from '@babylonjs/core';
import { iconButton } from '../ui/icon.js';
import { modifierStack } from '../modifiers/stack.js';
import { geometryGraph, isEvaluating, storeGeometryGraph } from './geometry-nodes.js';

const debounce = (fn, ms = 400) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
const observed = new WeakSet();
const watchBuilds = (graph, fn) => { if (observed.has(graph)) return; observed.add(graph); graph.onBuildObservable.add(fn); };
const toggle = (label, checked, run) => {
  const b = document.createElement('label');
  b.className = 'bl-toggle';
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  input.onchange = () => run(input.checked);
  b.append(input, label);
  return b;
};

export function createNodeContexts({ world, editor }) {
  const activeMesh = () => { const node = editor.selection.nodes.at(-1); return node?.getTotalVertices ? node : null; };
  return {
    shader() {
      const mesh = activeMesh(), material = world.materials.activeMaterial(mesh);
      if (!mesh) return { key: 'none', message: 'Select a mesh object to edit its material nodes.' };
      if (!material) return { key: 'empty:' + mesh.uniqueId, title: mesh.name, message: 'The active material slot is empty.', buttons: [['New Material', () => world.materials.newMaterial(mesh, undefined, 'node'), 'add']] };
      if (!(material instanceof NodeMaterial)) return { key: 'flat:' + material.uniqueId, title: material.name, message: material.name + ' is a ' + world.materials.types[world.materials.type(material)]?.title + ' material.', buttons: [['Use Nodes', () => world.materials.convert(material, 'node'), 'node_material']] };
      return {
        key: 'node:' + material.uniqueId, title: material.name, graph: material,
        onShow: () => watchBuilds(material, debounce(() => world.materials.markGraphEdited(material))),
      };
    },
    geometry() {
      const mesh = activeMesh();
      if (!mesh) return { key: 'none', message: 'Select a mesh object to edit its Geometry Nodes.' };
      const modifier = modifierStack(mesh).find(m => m.type === 'NODES');
      if (!modifier) return { key: 'add:' + mesh.uniqueId, title: mesh.name, message: mesh.name + ' has no Geometry Nodes modifier.', buttons: [['New', () => world.modifiers.add(mesh, 'NODES'), 'add']] };
      const graph = geometryGraph(modifier);
      return {
        key: 'nodes:' + modifier.id + ':' + graph.uniqueId, title: mesh.name + ' › ' + modifier.name, graph,
        onShow: () => watchBuilds(graph, debounce(() => { if (isEvaluating()) return; storeGeometryGraph(modifier); world.modifiers.refresh(); world.modifiers.update(mesh, modifier.id, {}); }, 300)),
      };
    },
    compositor() {
      const c = world.compositor;
      const use = toggle('Use Nodes', c.enabled, value => c.setEnabled(value));
      if (!c.enabled || !c.graph) return { key: 'off:' + c.enabled, title: 'Compositing', actions: [use], message: 'Enable Use Nodes to composite the scene through a Babylon frame graph.', buttons: [['Use Nodes', () => c.setEnabled(true), 'node_compositing']] };
      return { key: 'on:' + c.graph.uniqueId, title: 'Compositing', actions: [use], graph: c.graph };
    },
    particles() {
      const mesh = activeMesh(), entry = world.particles.active(mesh);
      if (!mesh) return { key: 'none', message: 'Select an emitter object to edit its particle nodes.' };
      if (!entry) return { key: 'add:' + mesh.uniqueId, title: mesh.name, message: mesh.name + ' has no particle systems.', buttons: [['New Particle System', () => world.particles.add(mesh), 'add']] };
      const graph = world.particles.graph(entry.id);
      if (!graph) return { key: 'wait:' + entry.id, title: entry.name, message: 'Building particle system…' };
      return { key: 'set:' + entry.id + ':' + graph.uniqueId, title: mesh.name + ' › ' + entry.name, graph, actions: [iconButton('restrict_view_off', 'Show in viewport', () => world.particles.update(mesh, entry.id, { enabled: !entry.enabled }), entry.enabled ? 'active' : '')] };
    },
    logic: () => world.logic?.context() || { key: 'none', message: 'Logic Editor is not available.' },
  };
}
