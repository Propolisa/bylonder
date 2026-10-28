// bpy.context for one editor (BKE_context.hh, with the members screen_context.cc and space_view3d.cc give): the
// window, screen, area and region it is drawn in, and the scene's data through Bylonder's RNA (makesrna/rna-bylonder.js).
//   r: createRNA(host), area: the editor's Blender type (uiType its sub-type, TIMELINE), region: the region's, space: the editor's own data (a 3D
//   Viewport's view, editors/space_view3d/view3d.js), or none for Blender's defaults, members: the editor's own
//   members (the Properties editor's, space_buttons/buttons-context.js) as getters over the context.
import { rna, collection } from '../makesrna/rna.js';

const SPACES = { VIEW_3D: 'SpaceView3D', PROPERTIES: 'SpaceProperties', OUTLINER: 'SpaceOutliner', DOPESHEET_EDITOR: 'SpaceDopeSheetEditor', GRAPH_EDITOR: 'SpaceGraphEditor',
  NODE_EDITOR: 'SpaceNodeEditor', SEQUENCE_EDITOR: 'SpaceSequenceEditor', TEXT_EDITOR: 'SpaceTextEditor', FILE_BROWSER: 'SpaceFileBrowser', TOPBAR: 'Space' };
const REGION_DATA = { VIEW_3D: 'RegionView3D' };
// CTX_data_mode_enum for an object in Edit Mode, by its type.
const EDIT_MODES = { MESH: 'EDIT_MESH', CURVE: 'EDIT_CURVE', FONT: 'EDIT_TEXT' };

export function createContext(r, { area: type = 'VIEW_3D', uiType = type, region: regionType = 'WINDOW', space = null, members } = {}) {
  const { world, host } = r;
  const object = (ob) => r.pointer('Object', ob);
  const scene = r.pointer('Scene', world), view_layer = world.collections ? r.pointer('ViewLayer', world.collections.layer()) : rna('ViewLayer', { name: 'ViewLayer' });
  const space_data = space ? r.pointer(SPACES[type], space) : rna(SPACES[type] ?? 'Space');
  // A region given as its type, or as { type, width, height } where its size matters (the toolbar's layout).
  const { type: region_type = regionType, ...size } = typeof regionType === 'string' ? {} : regionType;
  const region_data = REGION_DATA[type] && region_type === 'WINDOW' ? space_data.region_3d ?? null : null;
  const area = rna('Area', { type, ui_type: uiType, show_menus: true, spaces: collection([space_data]) });
  const region = rna('Region', { type: region_type, ...size, view2d: rna('View2D', { region_to_view: (x, y) => [x, y] }) });
  const screen = rna('Screen', { areas: collection([area]) });
  const window = rna('Window', { scene, view_layer, screen });
  const editObject = () => world.editMode?.object ?? null;
  // Bylonder's active object is the last selected, or the one in Edit Mode.
  const activeObject = () => editObject() ?? host.selection?.nodes.at(-1) ?? null;
  const selected = () => r.objects().filter((ob) => host.selection?.has(ob));
  const visible = () => r.objects().filter((ob) => ob.isEnabled() && ob.isVisible !== false);
  const editable = (list) => list.filter((ob) => !ob.metadata?.wbLocked);
  const inMode = () => (editObject() ? [object(editObject())] : []);
  const data = {
    window, screen, area, region, space_data, region_data, scene, view_layer,
    get engine() { return scene.render.engine; },
    workspace: r.pointer('WorkSpace', world),
    tool_settings: scene.tool_settings,
    preferences: rna('Preferences', { system: rna('PreferencesSystem', { ui_scale: 1 }), ...host.preferences }),
    blend_data: rna('BlendData', { scenes: collection([scene]), objects: scene.objects }),
    get mode() { const ob = editObject(); return ob ? EDIT_MODES[object(ob).type] ?? 'OBJECT' : 'OBJECT'; },
    get object() { return object(activeObject()); },
    get active_object() { return object(activeObject()); },
    get edit_object() { return object(editObject()); },
    get selected_objects() { return selected().map(object); },
    get selected_editable_objects() { return editable(selected()).map(object); },
    get visible_objects() { return visible().map(object); },
    get selectable_objects() { return visible().filter((ob) => ob.isPickable !== false && !ob.metadata?.wbLocked).map(object); },
    get editable_objects() { return editable(visible()).map(object); },
    get objects_in_mode() { return inMode(); },
    get objects_in_mode_unique_data() { return inMode(); },
  };
  if (members) Object.defineProperties(data, Object.getOwnPropertyDescriptors(members(data)));
  return rna('Context', data);
}
