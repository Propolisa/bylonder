// blender-port: cycles/ui.py get_panels and register: Cycles shows Blender's panels the Blender render engine shows, but
// those it replaces with its own. Its add-on runs in Blender's Python, which does not see Bylonder's panels. The list
// leaves out its names Blender 5.2 no longer has (DATA_PT_falloff_curve, MATERIAL_PT_context_material).
import { panels } from '../python/bpy_interface.js';

const REPLACED = new Set(['DATA_PT_camera_dof', 'DATA_PT_light', 'DATA_PT_preview', 'DATA_PT_spot', 'MATERIAL_PT_preview',
  'NODE_DATA_PT_light', 'NODE_DATA_PT_spot', 'OBJECT_PT_visibility', 'VIEWLAYER_PT_filter', 'VIEWLAYER_PT_layer_passes',
  'RENDER_PT_post_processing', 'RENDER_PT_simplify']);

export function showBlenderPanels() {
  for (const [name, panel] of Object.entries(panels)) {
    const engines = panel.COMPAT_ENGINES;
    if (engines?.includes('BLENDER_RENDER') && !REPLACED.has(name) && !engines.includes('CYCLES')) engines.add('CYCLES');
  }
}
