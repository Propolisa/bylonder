import { NodeRenderGraph } from '@babylonjs/core';
import { bindGraph } from '../nodes/bindings.js';
import { compositorGraph } from './compositor-tree.js';
import { BlenderGroupOutputBlock } from '../nodes/blender/compositor-io.js';

// Blender's new compositing node group (node.new_compositing_node_group): Render Layers into the Group Output.
const NEW_TREE = { name: 'Compositor Nodes', nodes: [{ idname: 'CompositorNodeRLayers', name: 'Render Layers', location: [-200, 0] },
  { idname: 'NodeGroupOutput', name: 'Group Output', values: { Socket_0: null }, location: [200, 0] }], links: [['Render Layers', 'Image', 'Group Output', 'Socket_0']] };

export function createCompositor(world, { commit = () => {}, notify = console.warn } = {}) {
  const { scene, animation } = world;
  let graph = null, enabled = false, edited = false, building = false, camera = null, viewport = false;
  // camera: the camera the composite is rendered from; applied to the graph's camera inputs on every build.
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const cameraBlocks = () => (graph?.attachedBlocks || []).filter(b => b.getClassName() === 'NodeRenderGraphInputBlock' && b.isCamera?.());
  const own = next => {
    graph = next;
    graph.onBuildObservable.add(() => { if (!building) { edited = true; bind(); commit(); emit(); } });
    return graph;
  };
  const ensure = json => {
    if (graph) return graph;
    if (!json) return own(compositorGraph(NEW_TREE, scene).graph);
    const next = new NodeRenderGraph('Compositing', scene, { rebuildGraphOnEngineResize: true });
    next.parseSerializedObject(json);
    return own(next);
  };
  const bind = () => graph && bindGraph(animation, { id: 'compositor', title: 'Compositing', graph: () => graph, kind: 'render' });
  const build = async () => {
    building = true;
    try {
      if (camera) for (const block of cameraBlocks()) block.value = camera;
      graph.build(); await graph.whenReadyAsync();
    } finally { building = false; }
    scene.frameGraph = enabled && viewport ? graph.frameGraph : null;
  };
  const api = {
    get graph() { return graph; },
    get enabled() { return enabled; },
    // Whether the graph ends in Blender's Group Output, which displays through the view transform (a graph made in
    // Babylon's editor shows what its blocks draw).
    get viewTransformed() { return !!graph?.attachedBlocks.some((block) => block instanceof BlenderGroupOutputBlock); },
    // Per view, before it renders: whether this view shows the composite. Cheap (swaps the scene's render function).
    setViewportActive(value) { viewport = value; const next = graph && enabled && value ? graph.frameGraph : null; if (scene.frameGraph !== next) scene.frameGraph = next; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    fields: () => (graph ? bindGraph(animation, { id: 'compositor', title: 'Compositing', graph: () => graph, kind: 'render' }) : []),
    async setEnabled(value, { record = true } = {}) {
      enabled = value;
      if (value) {
        ensure();
        try { await build(); bind(); } catch (error) { enabled = false; scene.frameGraph = null; notify('Compositor: ' + error.message); }
      } else scene.frameGraph = null;
      if (record) commit();
      emit();
    },
    // The camera the composite is rendered from (one view at a time shows the compositor). Rebuilds on change.
    bindCamera(next) {
      if (!next || next === camera) return;
      camera = next;
      if (graph && enabled) build().catch(error => notify('Compositor: ' + error.message));
    },
    get camera() { return camera; },
    // An edit in the node editor, recorded; rebuilt when it changed the graph's blocks, links or code.
    async edit(rebuild) {
      edited = true;
      if (rebuild && enabled) await build().catch(error => notify('Compositor: ' + error.message));
      bind();
      commit();
    },
    syncCamera() { api.bindCamera(scene.activeCamera); },
    // A read file's compositing node group (compositor-tree.js), composited when the file's render uses compositing.
    // Returns the node types it does not run. A compositor the project already has (a saved one's) is kept.
    async adopt(tree, { use_compositing = true } = {}) {
      if (graph) return [];
      let read;
      try { read = compositorGraph(tree, scene, tree.name); } catch (error) { notify(`Compositor: "${tree.name}" is not opened: ${error.message}`); return []; }
      const { graph: next, missing } = read;
      own(next);
      edited = true;
      if (missing.length) notify(`Compositor: its ${missing.join(', ')} nodes are not composited`);
      await api.setEnabled(use_compositing, { record: false });
      emit();
      return missing;
    },
    capture: () => ({ enabled, graph: graph && (edited || enabled) ? graph.serialize() : null }),
    async apply(state = {}) {
      if (state.graph) {
        const json = JSON.stringify(state.graph);
        if (!graph || JSON.stringify(graph.serialize()) !== json) {
          scene.frameGraph = null;
          graph?.dispose();
          graph = null;
          ensure(state.graph);
          edited = true;
        }
      }
      if (!!state.enabled !== enabled) await api.setEnabled(!!state.enabled, { record: false });
      else if (enabled && state.graph) await build();
      emit();
    },
    dispose() { scene.frameGraph = null; graph?.dispose(); listeners.clear(); },
  };
  return api;
}
