import { NodeMaterial } from '@babylonjs/core';
import { iconButton } from '../interface/icon.js';
import { modifierStack } from '../../modifiers/stack.js';
import { geometryGraph, isEvaluating, storeGeometryGraph } from '../../nodes/geometry-nodes.js';
import { mountLogicEditor } from './logic-editor.js';

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

// Bylonder's Node Editor (blender-node-editor.js), loaded when first shown.
const blenderEditor = (graph, changed) => (host) => {
  let mounted = null, disposed = false;
  import('./blender-node-editor.js').then(({ mountBlenderNodeEditor }) => { if (!disposed) mounted = mountBlenderNodeEditor(host, graph, { changed }); });
  return { frameAll: () => mounted?.frameAll(), dispose: () => { disposed = true; mounted?.dispose(); } };
};

const newButton = (run) => {
  const b = iconButton('add', 'New compositor node group', run);
  b.classList.add('bl-text-toggle');
  b.append('New');
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
      const edited = debounce(() => world.materials.markGraphEdited(material));
      return {
        key: 'node:' + material.uniqueId, title: material.name, graph: material,
        mount: blenderEditor(material, (rebuild) => { if (rebuild) material.build(); edited(); }),
        onShow: () => watchBuilds(material, edited),
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
      // Blender 5 shows the compositor node group as a datablock: New when there is none, its name and X otherwise.
      if (!c.enabled || !c.graph) return { key: 'off:' + c.enabled, title: '', actions: [newButton(() => c.setEnabled(true))], message: 'Add a compositor node group to composite the scene through a Babylon frame graph.', buttons: [['New', () => c.setEnabled(true), 'add']] };
      return {
        key: 'on:' + c.graph.uniqueId, title: 'Compositing', actions: [iconButton('x', 'Remove the compositor', () => c.setEnabled(false))], graph: c.graph,
        hint: 'The composite shows in the backdrop, and in a viewport in Rendered shading or camera view.',
        mount: blenderEditor(c.graph, (rebuild) => c.edit(rebuild)),
      };
    },
    particles() {
      const mesh = activeMesh(), entry = world.particles.active(mesh);
      if (!mesh) return { key: 'none', message: 'Select an emitter object to edit its particle nodes.' };
      if (!entry) return { key: 'add:' + mesh.uniqueId, title: mesh.name, message: mesh.name + ' has no particle systems.', buttons: [['New Particle System', () => world.particles.add(mesh), 'add']] };
      const graph = world.particles.graph(entry.id);
      if (!graph) return { key: 'wait:' + entry.id, title: entry.name, message: 'Building particle system…' };
      return { key: 'set:' + entry.id + ':' + graph.uniqueId, title: mesh.name + ' › ' + entry.name, graph, actions: [iconButton('restrict_view_off', 'Show in viewport', () => world.particles.update(mesh, entry.id, { enabled: !entry.enabled }), entry.enabled ? 'active' : '')] };
    },
    logic() {
      const logic = world.logic;
      if (!logic) return { key: 'none', message: 'Logic Editor is not available.' };
      let editor = null;
      const add = Object.assign(document.createElement('button'), { type: 'button', className: 'bl-pulldown', textContent: 'Add', onclick: () => editor?.addMenu() });
      return { key: 'logic', title: 'Logic', graph: logic, mount: host => (editor = mountLogicEditor(host, logic)), actions: [add, toggle('Run', logic.running, value => logic.setRunning(value))] };
    },
  };
}
