// Which typed items of Blender's Add menus (object.modifier_add:ARRAY, node.add_node:GeometryNodeMeshCube) this window
// runs, for the Blender Coverage view: a modifier type Bylonder defines, a node type its tree's editor runs.
import { modifierDefinitions } from '../modifiers/stack.js';
import { structFind } from '../python/bpy_rna.js';
import { shaderNodeClasses } from '../nodes/blender/shader-nodes.js';
import { compositorNodeClasses } from '../nodes/blender/compositor-nodes.js';

const LAYOUT = ['NodeReroute', 'NodeFrame'];
const NODE_TREES = {
  ShaderNodeTree: (type) => type in shaderNodeClasses || LAYOUT.includes(type),
  CompositorNodeTree: (type) => type in compositorNodeClasses || LAYOUT.includes(type),
  // Blender's geometry nodes evaluate in the module: every node type it registers runs.
  GeometryNodeTree: (type) => !!structFind(type),
};

export function variantRuns(area, id) {
  const [operator, type] = id.split(':');
  if (operator === 'object.modifier_add') return [...modifierDefinitions.values()].some((d) => d.blender === id);
  return operator === 'node.add_node' && !!NODE_TREES[area]?.(type);
}
