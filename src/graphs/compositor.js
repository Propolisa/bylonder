import { NodeRenderGraph } from '@babylonjs/core';
import { bindGraph } from './bindings.js';

export function createCompositor(world, { commit = () => {}, notify = console.warn } = {}) {
  const { scene, animation } = world;
  let graph = null, enabled = false, edited = false, building = false, camera = null, viewport = false;
  // camera: the camera the composite is rendered from; applied to the graph's camera inputs on every build.
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const cameraBlocks = () => (graph?.attachedBlocks || []).filter(b => b.getClassName() === 'NodeRenderGraphInputBlock' && b.isCamera?.());
  const ensure = json => {
    if (graph) return graph;
    graph = new NodeRenderGraph('Compositing', scene, { rebuildGraphOnEngineResize: true });
    if (json) graph.parseSerializedObject(json); else graph.setToDefault();
    graph.onBuildObservable.add(() => { if (!building) { edited = true; bind(); commit(); emit(); } });
    return graph;
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
    syncCamera() { api.bindCamera(scene.activeCamera); },
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
