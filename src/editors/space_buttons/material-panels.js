import { h } from 'vue';
import { icon } from '../interface/layout-view.js';
import { bindGraph } from '../../nodes/bindings.js';
import { materialId } from '../../blenkernel/material/library.js';

// Properties > Material, after Blender's panels: the Babylon material type behind the active slot's material (a
// Principled BSDF in Blender's panels), and a node material's inputs, edited in the Shader Editor.
export function materialPanels({ world, node, row, panel }) {
  const library = world.materials, material = library.activeMaterial(node);
  if (!material) return [];
  const id = materialId(material), type = library.type(material);
  const graphRows = () => {
    const rows = bindGraph(world.animation, { id: 'material:' + id + ':graph', title: material.name, graph: material, kind: 'material' }).map(f => row({ ...f, default: undefined }));
    return [...(rows.length ? rows : [h('p', { class: 'bl-message' }, 'No uniform inputs. Add Input blocks in the Shader Editor to expose values here.')]),
      h('button', { type: 'button', class: 'bl-widget bl-tool flex h-unit items-center justify-center gap-1 rounded-md text-xs', onClick: () => world.openNodeEditor?.('shader') }, [icon('NODE_MATERIAL'), 'Open in Shader Editor'])];
  };
  return [panel('material.babylon', 'Babylon Material', () => [
    row({ id: 'mat.' + id + '.type', label: 'Type', options: Object.fromEntries(Object.entries(library.types).map(([k, t]) => [t.title, k])), default: type, get: () => type, set: v => library.convert(material, v) }),
    ...(type === 'node' ? graphRows() : []),
  ], { defaultClosed: type !== 'node' })];
}
