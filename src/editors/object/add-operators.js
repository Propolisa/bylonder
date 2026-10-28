// The Add panel's presets (add-mesh.js) as the Blender operators they run, so Blender's Add menu (VIEW3D_MT_add) and
// its Shift A add them; Babylon's own primitives join Blender's Mesh menu as an add-on's would.
import { registerOperator, appendMenu, kw } from '../../windowmanager/wm-operators.js';

export function registerAddOperators(creator) {
  const babylon = creator.catalog.filter((preset) => preset.group === 'babylon');
  for (const preset of creator.catalog) {
    const idname = preset.operator ?? `bylonder.${preset.id}_add`;
    // The properties a script or the HUD sets: the preset's options (and the placement tool's scale) and where it goes.
    const options = (props) => Object.fromEntries(Object.entries(props).filter(([name]) => name in preset.schema || name === 'scale'));
    registerOperator(idname, { run: (props = {}) => creator.add(preset, { options: options(props), location: props.location, rotation: props.rotation }) });
  }
  appendMenu('VIEW3D_MT_mesh_add', ({ layout }) => {
    layout.separator();
    for (const preset of babylon) layout.operator(`bylonder.${preset.id}_add`, kw({ text: preset.title, icon: 'MESH_DATA' }));
  });
}
