// The ends of the compositor's graph as Blender's nodes: Render Layers is Babylon's object renderer (the scene through
// the camera, in scene linear), its Image output Babylon's; the Group Output shows the composite through the scene's
// view settings, as Blender's compositor result is displayed, with the display transform a rendered view ends with
// (render/display-transform.js). Their Babylon inputs (camera, objects, target) are not Blender's and are not drawn.
import { FrameGraphPostProcessTask, NodeRenderGraphBasePostProcessBlock, NodeRenderGraphObjectRendererBlock, RegisterClass } from '@babylonjs/core';
import { DisplayTransformEffect } from '../../render/display-transform.js';
import { declaration } from './declarations.js';

const blenderNode = (idname, decl) => ({ idname, declaration: decl, properties: {}, values: {} });

// Render Layers' declaration with its Image as Babylon's renderer output; its passes are shown, not given yet.
const renderLayers = declaration('compositor', 'CompositorNodeRLayers');
const RENDER_LAYERS = { ...renderLayers, properties: {}, outputs: renderLayers.outputs.map((s) => (s.identifier === 'Image' ? { ...s, identifier: 'output' } : s)) };
export class BlenderRenderLayersBlock extends NodeRenderGraphObjectRendererBlock {
  constructor(name = 'Render Layers', frameGraph, scene) {
    super(name, frameGraph, scene);
    Object.assign(this, blenderNode('CompositorNodeRLayers', RENDER_LAYERS));
  }
  getClassName() { return 'CompositorNodeRLayers'; }
  declared(name) { return RENDER_LAYERS.outputs.some((s) => s.identifier === name); }
}
RegisterClass('BABYLON.CompositorNodeRLayers', BlenderRenderLayersBlock);

// The Group Output's one image (Blender's first interface socket), Babylon's post process source.
const GROUP_OUTPUT = { ...declaration('compositor', 'NodeGroupOutput'), properties: {},
  inputs: [{ identifier: 'source', name: 'Image', type: 'RGBA', shape: 'CIRCLE', hide_value: true, color: [0.78, 0.78, 0.16, 1] }] };
export class BlenderGroupOutputBlock extends NodeRenderGraphBasePostProcessBlock {
  constructor(name = 'Group Output', frameGraph, scene) {
    super(name, frameGraph, scene);
    this._finalizeInputOutputRegistering();
    this._frameGraphTask = new FrameGraphPostProcessTask(this.name, frameGraph, new DisplayTransformEffect(this.name, scene));
    Object.assign(this, blenderNode('NodeGroupOutput', GROUP_OUTPUT));
  }
  get task() { return this._frameGraphTask; }
  getClassName() { return 'CompositorNodeGroupOutput'; }
  declared(name) { return name === 'source'; }
}
RegisterClass('BABYLON.CompositorNodeGroupOutput', BlenderGroupOutputBlock);
