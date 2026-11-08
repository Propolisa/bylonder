import { NodeMaterial } from '@babylonjs/core';
import { iconButton } from '../interface/icon.js';
import { modifierStack } from '../../modifiers/stack.js';
import { geometryGraph, isEvaluating, storeGeometryGraph } from '../../nodes/geometry-nodes.js';
import { mountLogicEditor } from './logic-editor.js';
import { buildMaterial } from '../../nodes/blender/shader-nodes.js';
import { idStruct, pointerOf } from '../../python/bpy_rna.js';

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

// Bylonder's Node Editor (blender-node-editor.js), loaded when first shown, on a Babylon graph or a node tree of Main's.
const blenderEditor = (graph, changed, mainTree = false, kind = undefined) => (host) => {
  let mounted = null, disposed = false;
  Promise.all([import('./blender-node-editor.js'), mainTree && import('./main-node-tree.js')]).then(([{ mountBlenderNodeEditor }, main]) => {
    if (!disposed) mounted = mountBlenderNodeEditor(host, graph, { changed, ...(main && { tree: main.createMainNodeTree(graph, { changed, kind }) }) });
  });
  return { frameAll: () => mounted?.frameAll(), refresh: () => mounted?.editor.refresh(), dispose: () => { disposed = true; mounted?.dispose(); } };
};

const newButton = (run) => {
  const b = iconButton('add', 'New compositor node group', run);
  b.classList.add('bl-text-toggle');
  b.append('New');
  return b;
};

export function createNodeContexts({ world, editor, commit = () => {} }) {
  const activeMesh = () => { const node = editor.selection.active; return node?.getTotalVertices ? node : null; };
  // The active object where its type has materials (a mesh, or Main's Curves, Text and the like).
  const activeWithMaterials = () => { const node = editor.selection.active; return node && (node.getTotalVertices || world.mainSync?.slots(node)) ? node : null; };
  // The node group of the active object's active Geometry Nodes modifier, as Blender's Geometry Node Editor shows it.
  const mainNodeGroup = (node) => {
    const ob = node && world.mainSync.objectOf(node), modifier = ob && idStruct(ob).modifiers.active;
    return modifier?.type === 'NODES' ? { modifier, group: modifier.node_group } : null;
  };
  return {
    shader() {
      const object = activeWithMaterials(), material = world.materials.activeMaterial(object);
      if (!object) return { key: 'none', message: 'Select an object with materials to edit its material nodes.' };
      if (!material) return { key: 'empty:' + object.uniqueId, title: object.name, message: 'The active material slot is empty.', buttons: [['New Material', () => world.materials.newMaterial(object, undefined, 'node'), 'add']] };
      if (!(material instanceof NodeMaterial)) return { key: 'flat:' + material.uniqueId, title: material.name, message: material.name + ' is a ' + world.materials.types[world.materials.type(material)]?.title + ' material.', buttons: [['Use Nodes', () => world.materials.convert(material, 'node'), 'node_material']] };
      const edited = debounce(() => world.materials.markGraphEdited(material));
      return {
        key: 'node:' + material.uniqueId, title: material.name, graph: material,
        mount: blenderEditor(material, (rebuild) => { if (rebuild) buildMaterial(material); edited(); }),
        onShow: () => watchBuilds(material, edited),
      };
    },
    geometry() {
      const node = editor.selection.active, main = mainNodeGroup(node);
      if (main?.group) {
        const sync = world.mainSync;
        return {
          key: 'main:' + pointerOf(main.group)[2], title: node.name + ' › ' + main.modifier.name + ' › ' + main.group.name, graph: main.group, babylon: false,
          mount: blenderEditor(main.group, () => { sync.view(); commit(); }, true),
        };
      }
      if (main) return { key: 'empty:' + node.uniqueId, title: node.name + ' › ' + main.modifier.name, message: main.modifier.name + ' has no node group.' };
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
      const remove = iconButton('x', 'Unlink the compositing node group', () => c.remove());
      const hint = 'The composite shows in the backdrop, and in a Rendered viewport whose Viewport Shading > Compositor is on.';
      // The scene's compositing node group, which Blender holds: edited as Blender's, and composited as edited.
      if (c.main) return { key: 'main:' + pointerOf(c.group)[2], title: c.group.name, actions: [remove], graph: c.group, babylon: false, hint, mount: blenderEditor(c.group, () => { world.mainSync.view(); c.edit(); }, true, 'compositor') };
      return {
        key: 'on:' + c.graph.uniqueId, title: 'Compositing', actions: [remove], graph: c.graph,
        hint,
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
