// A world of nodes for the export tests, as Bylonder adopts a read World with more than a Background
// (main-view.js adoptWorld): a gradient of the view's direction, colored by a ramp, as the Background.
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';
import { createWorld } from '../src/blenkernel/scene/world.js';

const TREE = {
  nodes: [
    { idname: 'ShaderNodeTexGradient', name: 'Gradient', properties: { gradient_type: 'EASING' } },
    { idname: 'ShaderNodeValToRGB', name: 'Sky Colors', properties: { color_ramp: { color_mode: 'RGB', interpolation: 'LINEAR', hue_interpolation: 'NEAR',
      elements: [{ position: 0, color: [0.02, 0.03, 0.08, 1] }, { position: 1, color: [0.6, 0.45, 0.3, 1] }] } } },
    { idname: 'ShaderNodeBackground', name: 'Background', values: { Strength: 1.5 } },
    { idname: 'ShaderNodeOutputWorld', name: 'World Output' },
  ],
  links: [['Gradient', 'Fac', 'Sky Colors', 'Fac'], ['Sky Colors', 'Color', 'Background', 'Color'], ['Background', 'Background', 'World Output', 'Surface']],
};

// The scene's world made this node world; gives its material.
export function nodeWorld(scene) {
  const { material } = nodeMaterialFromTree('__world World', scene, TREE);
  createWorld(scene, { color: [0.05, 0.05, 0.1], strength: 1, nodes: material });
  return material;
}
