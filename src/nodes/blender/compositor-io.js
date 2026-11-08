// The ends of the compositor's graph as Blender's nodes. Render Layers is the view's own render (an external texture
// input: the rendered view's image after its film and effects, in scene linear, where the view transform takes it);
// the Group Output's composite is copied back there, so the view displays it through its view transform and draws its
// overlays over it, as Blender displays its compositor's result (compositor.js runs the graph per rendered frame).
import { FrameGraphCopyToTextureTask, NodeRenderGraphBlockConnectionPointTypes, NodeRenderGraphInputBlock, NodeRenderGraphOutputBlock, RegisterClass } from '@babylonjs/core';
import { declaration } from './declarations.js';

const blenderNode = (idname, decl) => ({ idname, declaration: decl, properties: {}, values: {} });

// Render Layers' declaration with its Image as the input block's output; its passes are shown, not given yet.
const renderLayers = declaration('compositor', 'CompositorNodeRLayers');
const RENDER_LAYERS = { ...renderLayers, properties: {}, outputs: renderLayers.outputs.map((s) => (s.identifier === 'Image' ? { ...s, identifier: 'output' } : s)) };
export class BlenderRenderLayersBlock extends NodeRenderGraphInputBlock {
  constructor(name = 'Render Layers', frameGraph, scene) {
    super(name, frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.Texture);
    Object.assign(this, blenderNode('CompositorNodeRLayers', RENDER_LAYERS));
    this.isExternal = true;
  }
  getClassName() { return 'CompositorNodeRLayers'; }
  declared(name) { return RENDER_LAYERS.outputs.some((s) => s.identifier === name); }
  // The view's render this frame (an InternalTexture), imported under the handle the graph was built with.
  setRender(texture) {
    this.value = texture;
    if (this.output.value !== undefined) this._frameGraph.textureManager.importTexture(this.name, texture, this.output.value);
  }
}
RegisterClass('BABYLON.CompositorNodeRLayers', BlenderRenderLayersBlock);

// The Group Output's one image (Blender's first interface socket): the composite, which compositor.js copies over the
// view's render. As a frame graph task it does nothing (Babylon's output block would copy to the canvas).
const GROUP_OUTPUT = { ...declaration('compositor', 'NodeGroupOutput'), properties: {},
  inputs: [{ identifier: 'texture', name: 'Image', type: 'RGBA', shape: 'CIRCLE', hide_value: true, color: [0.78, 0.78, 0.16, 1] }] };
export class BlenderGroupOutputBlock extends NodeRenderGraphOutputBlock {
  constructor(name = 'Group Output', frameGraph, scene) {
    super(name, frameGraph, scene);
    Object.assign(this, blenderNode('NodeGroupOutput', GROUP_OUTPUT));
    this._frameGraphTask = Object.assign(new FrameGraphCopyToTextureTask(name, frameGraph), { disabled: true });
  }
  getClassName() { return 'CompositorNodeGroupOutput'; }
  declared(name) { return name === 'texture'; }
  _buildBlock(state) {
    super._buildBlock(state);
    this._frameGraphTask.targetTexture = this.texture.connectedPoint?.value;
  }
  // The composite's handle, null when nothing is linked.
  get result() { return this.texture.connectedPoint?.value ?? null; }
}
RegisterClass('BABYLON.CompositorNodeGroupOutput', BlenderGroupOutputBlock);