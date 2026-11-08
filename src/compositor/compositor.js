import { CopyTextureToTexture, NodeRenderGraph } from '@babylonjs/core';
import { bindGraph } from '../nodes/bindings.js';
import { compositorGraph } from './compositor-tree.js';
import { compositeFinalFrame } from './compositor-cpu.js';
import { BlenderRenderLayersBlock } from '../nodes/blender/compositor-io.js';
import { blendData, idStruct } from '../python/bpy_rna.js';

// A new compositor without Main (a world without Blender's module): Render Layers into the Group Output.
const NEW_TREE = { name: 'Compositor Nodes', nodes: [{ idname: 'CompositorNodeRLayers', name: 'Render Layers', location: [-200, 0] },
  { idname: 'NodeGroupOutput', name: 'Group Output', values: { Socket_0: null }, location: [200, 0] }], links: [['Render Layers', 'Image', 'Group Output', 'Socket_0']] };

// What rebuilds the graph when Main's tree changes: its nodes, their properties, menus and switches (constants in the
// nodes' shaders), mutes and links. Its other values are the shaders' uniforms, set on the blocks.
const structure = ({ nodes, links }) => JSON.stringify([links, nodes.map(({ idname, name, properties, mute, values = {} }) =>
  [idname, name, properties, mute, Object.entries(values).filter(([, v]) => typeof v === 'string' || typeof v === 'boolean')])]);

export function createCompositor(world, { commit = () => {}, notify = console.warn } = {}) {
  const { scene, animation } = world;
  let graph = null, enabled = false, edited = false, building = false, camera = null, viewport = false;
  // shown: the structure of Main's compositing node group the graph was built from; null for a graph of Babylon's own
  // (a project saved before the compositor was Main's).
  let shown = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const mainScene = () => world.mainSync && idStruct(world.mainSync.blender.scene);
  const cameraBlocks = () => (graph?.attachedBlocks || []).filter(b => b.getClassName() === 'NodeRenderGraphInputBlock' && b.isCamera?.());
  // The graph's Render Layers: a graph of Blender's composites the view's render (composite below); one of Babylon's own
  // is the scene's frame graph, which renders the scene itself.
  const renderLayers = () => graph?.attachedBlocks.find((b) => b instanceof BlenderRenderLayersBlock) ?? null;
  let ready = false;
  const sceneGraph = () => (graph && !renderLayers() && enabled && viewport ? graph.frameGraph : null);
  // A rendered view's composite: once the pass before its view transform has drawn the render (scene linear, after the
  // film and effects), the graph runs on it and writes the composite back, which the view transform then displays.
  const hooked = new WeakSet();
  let copier = null;
  const composite = (view) => {
    const transform = world.renderSettings?.display(view)?.passes[0], chain = view._postProcesses ?? [];
    const before = chain.slice(0, chain.indexOf(transform)).findLast(Boolean);
    if (!transform || !before || hooked.has(before)) return;
    hooked.add(before);
    before.onAfterRenderObservable.add(() => {
      const layers = renderLayers();
      if (!layers || !ready || !enabled || !viewport || view !== camera || !transform.inputTexture) return;
      const render = transform.inputTexture;
      layers.setRender(render.texture);
      graph.frameGraph.execute();
      const result = graph.frameGraph.textureManager.getTextureFromHandle(graph.outputBlock.result);
      if (result && result !== render.texture) (copier ??= new CopyTextureToTexture(scene.getEngine())).copy(result, render);
    });
  };
  const own = next => {
    graph = next;
    graph.onBuildObservable.add(() => { if (!building) { edited = true; bind(); commit(); emit(); } });
    return graph;
  };
  const drop = () => { ready = false; scene.frameGraph = null; graph?.dispose(); graph = null; shown = null; };
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
    ready = false;
    try {
      if (camera) for (const block of cameraBlocks()) block.value = camera;
      graph.build(); await graph.whenReadyAsync();
      ready = true;
    } finally { building = false; }
    scene.frameGraph = sceneGraph();
  };
  const rebuild = () => build().catch(error => notify('Compositor: ' + error.message));
  // Blender's new compositing node group, the scene's (node.new_compositing_node_group, as Blender's New button runs it).
  const newGroup = () => {
    const before = new Set([...blendData().node_groups].map(g => g.name));
    world.mainSync.blender.run('node.new_compositing_node_group', { name: 'Compositor Nodes' });
    mainScene().compositing_node_group = [...blendData().node_groups].find(g => !before.has(g.name));
  };
  // Main's compositing node group drawn as the graph: built anew when its structure changed, else its values set on the
  // blocks of its nodes. Returns the node types it does not run.
  const fromMain = async () => {
    const tree = world.mainSync?.compositingTree();
    if (!tree) { if (shown) { drop(); emit(); } return []; }
    const key = structure(tree);
    if (graph && key === shown) {
      const blocks = new Map(graph.attachedBlocks.filter(b => b.values).map(b => [b.name, b]));
      for (const node of tree.nodes) for (const [id, value] of Object.entries(node.values ?? {})) {
        const block = blocks.get(node.name);
        if (block && value !== null && id in block.values) block.values[id] = value;
      }
      return [];
    }
    let read;
    try { read = compositorGraph(tree, scene, tree.name); } catch (error) { notify(`Compositor: "${tree.name}" is not opened: ${error.message}`); return []; }
    drop();
    own(read.graph);
    shown = key;
    edited = true;
    if (enabled) await rebuild();
    bind();
    emit();
    return read.missing;
  };
  const api = {
    get graph() { return graph; },
    get enabled() { return enabled; },
    // Whether the graph is Main's compositing node group, which the Compositor edits as Blender's (main-node-tree.js).
    get main() { return !!shown; },
    // Main's compositing node group, as Blender's RNA reads it.
    get group() { return shown ? mainScene().compositing_node_group : null; },
    // Whether final renders composite on Blender's CPU path (compositor-cpu.js), on Main's compositing node group; the
    // views composite on the GPU.
    get onCPU() { return enabled && !!shown; },
    finalFrame: (camera) => api.onCPU && compositeFinalFrame(world, camera),
    // Whether the scene's frame graph draws the view (a graph of Babylon's own), not the view's render and its view
    // transform.
    get drawsScene() { return !!sceneGraph(); },
    // Per view, before it renders: whether this view shows the composite. Cheap (swaps the scene's render function).
    setViewportActive(value) {
      viewport = value;
      if (value && camera && renderLayers()) composite(camera);
      const next = sceneGraph();
      if (scene.frameGraph !== next) scene.frameGraph = next;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    fields: () => (graph ? bindGraph(animation, { id: 'compositor', title: 'Compositing', graph: () => graph, kind: 'render' }) : []),
    // On, the scene composites through its compositing node group, a new one of Blender's when it has none.
    async setEnabled(value, { record = true } = {}) {
      enabled = value;
      if (value) {
        if (world.mainSync && !graph && !mainScene().compositing_node_group) newGroup();
        if (world.mainSync && !graph) await fromMain();
        ensure();
        try { await build(); bind(); } catch (error) { enabled = false; scene.frameGraph = null; notify('Compositor: ' + error.message); }
      } else scene.frameGraph = null;
      if (record) commit();
      emit();
    },
    // The Compositor's X: the scene's compositing node group unlinked, as Blender's ID template unlinks it.
    async remove() {
      if (shown) mainScene().compositing_node_group = null;
      drop();
      await api.setEnabled(false);
    },
    // The camera the composite is rendered from (one view at a time shows the compositor). Rebuilds on change.
    bindCamera(next) {
      if (!next || next === camera) return;
      camera = next;
      if (graph && enabled) rebuild();
    },
    get camera() { return camera; },
    // An edit in the node editor, recorded: of Main's tree (the graph follows it), or of a graph of Babylon's own,
    // rebuilt when it changed the graph's blocks, links or code.
    async edit(rebuild) {
      edited = true;
      if (shown) await fromMain();
      else if (rebuild && enabled) await build().catch(error => notify('Compositor: ' + error.message));
      bind();
      commit();
    },
    syncCamera() { api.bindCamera(scene.activeCamera); },
    // A read file's compositing node group in Main, composited when the file's render uses compositing. Returns the node
    // types it does not run. A compositor of Babylon's own the project already has is kept.
    async adopt({ use_compositing = true } = {}) {
      if (graph && !shown) return [];
      const missing = await fromMain();
      if (missing.length) notify(`Compositor: its ${missing.join(', ')} nodes are not composited`);
      await api.setEnabled(use_compositing, { record: false });
      return missing;
    },
    capture: () => ({ enabled, graph: graph && !shown && (edited || enabled) ? graph.serialize() : null }),
    async apply(state = {}) {
      if (state.graph) {
        const json = JSON.stringify(state.graph);
        if (!graph || JSON.stringify(graph.serialize()) !== json) {
          drop();
          ensure(state.graph);
          edited = true;
        }
      } else if (world.mainSync) await fromMain();
      if (!!state.enabled !== enabled) await api.setEnabled(!!state.enabled, { record: false });
      else if (enabled && graph) await build();
      emit();
    },
    dispose() { drop(); listeners.clear(); },
  };
  return api;
}
