// The Add panel's presets (add-mesh.js) as the Blender operators they run, so Blender's Add menu (VIEW3D_MT_add) and
// its Shift A add them; Babylon's own primitives join Blender's Mesh menu as an add-on's would.
import { registerOperator, appendMenu, kw } from '../../windowmanager/wm-operators.js';

const BLENDER = { text: 'object.text_add' };

export function registerAddOperators(creator) {
  const babylon = creator.catalog.filter((preset) => preset.group === 'babylon');
  for (const preset of creator.catalog) {
    const idname = preset.operator ?? BLENDER[preset.id] ?? `bylonder.${preset.id}_add`;
    registerOperator(idname, { run: () => creator.add(preset) });
  }
  appendMenu('VIEW3D_MT_mesh_add', ({ layout }) => {
    layout.separator();
    for (const preset of babylon) layout.operator(`bylonder.${preset.id}_add`, kw({ text: preset.title, icon: 'MESH_DATA' }));
  });
}
