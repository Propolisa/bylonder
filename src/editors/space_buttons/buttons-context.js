// The Properties editor's context, as Blender's buttons_context.cc computes it: which tabs the active (or pinned)
// object offers, the data each tab draws (context.object, context.light, context.material, ...), and the path the
// editor shows above its panels.
import { createContext } from '../../blenkernel/context.js';
import { INFO, blRna } from '../../makesrna/rna.js';
import { TEXTURE_TYPES, textureStruct } from '../../blenkernel/texture/texture.js';
import modifierTypes from '../../makesrna/rna-modifiers.json' with { type: 'json' };

// Blender's tabs in order (ED_buttons_tabs_list), null between groups.
const TABS = ['TOOL', null, 'RENDER', 'OUTPUT', 'VIEW_LAYER', 'SCENE', 'WORLD', null, 'COLLECTION', null, 'OBJECT', 'MODIFIER', 'SHADERFX',
  'PARTICLES', 'PHYSICS', 'CONSTRAINT', 'DATA', 'BONE', 'BONE_CONSTRAINT', 'MATERIAL', 'TEXTURE'];
// Object types with modifiers and materials (OB_TYPE_SUPPORT_MATERIAL), and each type's data member and icon.
const MODIFIER_TYPES = new Set(['MESH', 'CURVE', 'SURFACE', 'FONT', 'LATTICE', 'POINTCLOUD', 'VOLUME', 'CURVES', 'GREASEPENCIL']);
const MATERIAL_TYPES = new Set(['MESH', 'CURVE', 'SURFACE', 'FONT', 'META', 'GREASEPENCIL', 'CURVES', 'POINTCLOUD', 'VOLUME']);
const DATA = { MESH: ['mesh', 'MESH_DATA'], CURVE: ['curve', 'CURVE_DATA'], SURFACE: ['curve', 'SURFACE_DATA'], FONT: ['curve', 'FONT_DATA'],
  META: ['meta_ball', 'META_DATA'], LATTICE: ['lattice', 'LATTICE_DATA'], ARMATURE: ['armature', 'ARMATURE_DATA'], LIGHT: ['light', 'LIGHT_DATA'],
  CAMERA: ['camera', 'CAMERA_DATA'], SPEAKER: ['speaker', 'OUTLINER_DATA_SPEAKER'], LIGHT_PROBE: ['lightprobe', 'OUTLINER_DATA_LIGHTPROBE'],
  GREASEPENCIL: ['grease_pencil', 'OUTLINER_DATA_GREASEPENCIL'], CURVES: ['curves', 'CURVES_DATA'], POINTCLOUD: ['pointcloud', 'POINTCLOUD_DATA'],
  VOLUME: ['volume', 'VOLUME_DATA'], EMPTY: [null, 'EMPTY_DATA'] };
// The panels' bl_context per tab.
export const TAB_CONTEXTS = { TOOL: '.workspace', RENDER: 'render', OUTPUT: 'output', VIEW_LAYER: 'view_layer', SCENE: 'scene', WORLD: 'world',
  COLLECTION: 'collection', OBJECT: 'object', MODIFIER: 'modifier', SHADERFX: 'shaderfx', PARTICLES: 'particle', PHYSICS: 'physics',
  CONSTRAINT: 'constraint', DATA: 'data', BONE: 'bone', BONE_CONSTRAINT: 'bone_constraint', MATERIAL: 'material', TEXTURE: 'texture' };
// RNA_struct_ui_icon of the structs the path shows.
const ICONS = { Scene: 'SCENE_DATA', ViewLayer: 'RENDER_RESULT', World: 'WORLD', Collection: 'OUTLINER_COLLECTION', Object: 'OBJECT_DATA',
  Material: 'MATERIAL', Mesh: 'MESH_DATA', Camera: 'CAMERA_DATA', PointLight: 'LIGHT_DATA', SpotLight: 'LIGHT_DATA', SunLight: 'LIGHT_DATA', AreaLight: 'LIGHT_DATA',
  ...Object.fromEntries(TEXTURE_TYPES.map((type) => [textureStruct(type), 'TEXTURE'])) };
export const structIcon = (struct) => ICONS[struct?.[INFO]?.struct] ?? modifierTypes.types[struct?.type]?.icon ?? 'DOT';

// Whether a tab has something to show for an object (buttons_context_path_*).
function available(tab, ob, context) {
  switch (tab) {
    case 'COLLECTION': return context.collection !== null;
    case 'OBJECT': case 'PHYSICS': case 'CONSTRAINT': return !!ob;
    case 'MODIFIER': return !!ob && MODIFIER_TYPES.has(ob.type);
    case 'PARTICLES': return ob?.type === 'MESH';
    case 'DATA': return !!ob && ob.type in DATA;
    case 'BONE': case 'BONE_CONSTRAINT': return ob?.type === 'ARMATURE';
    case 'MATERIAL': return !!ob && MATERIAL_TYPES.has(ob.type);
    case 'TEXTURE': return !!context.texture_user;
    case 'SHADERFX': return false;
    default: return true;
  }
}

// The Properties editor's bpy.context: the base context with what buttons_context gives, for `space`, the editor's
// state ({ context, pin, search }).
export function propertiesContext(r, space) {
  return createContext(r, { area: 'PROPERTIES', space, members: (base) => {
    const object = () => space.pin ?? base.active_object;
    const data = (member) => { const ob = object(); return ob && DATA[ob.type]?.[0] === member ? ob.data : null; };
    const collections = r.world.collections;
    const members = {
      get object() { return object(); },
      get id() { return space.pin; },
      get material() { return object()?.active_material ?? null; },
      get material_slot() { const ob = object(); return ob?.material_slots[ob.active_material_index] ?? null; },
      get world() { return base.scene.world; },
      get collection() { return collections && collections.active !== collections.MASTER ? r.pointer('Collection', collections.byId(collections.active)) : null; },
      // The texture users (buttons_texture_users_from_context): the object's modifiers with a texture, the one chosen
      // in template_texture_user (space.textureUser) or the first, and the texture it points at.
      get texture_users() { return [...(object()?.modifiers ?? [])].filter((m) => m[INFO].bound.has('texture')); },
      get texture_user() { const users = members.texture_users; return users[space.textureUser ?? 0] ?? users[0] ?? null; },
      get texture_user_property() { const user = members.texture_user; return user && blRna(user[INFO].struct).properties.texture; },
      get texture() { return members.texture_user?.texture ?? null; },
      get particle_system() { return null; },
    };
    for (const member of new Set(Object.values(DATA).map(([name]) => name).filter(Boolean))) Object.defineProperty(members, member, { get: () => data(member), enumerable: true });
    return members;
  } });
}

// The tabs as SpaceProperties.context's enum items: [identifier, name, description, icon], null for a separator, the
// Data tab with the icon of the object's data.
export function propertiesTabs(context, items) {
  const ob = context.object, byId = Object.fromEntries(items.map((item) => [item[0], item]));
  const tabs = TABS.map((tab) => (tab === null ? null : available(tab, ob, context) ? byId[tab] : undefined)).filter((tab) => tab !== undefined);
  return tabs.filter((tab, i) => tab || (i > 0 && tabs[i - 1] && tabs.slice(i + 1).some(Boolean)))
    .map((tab) => (tab?.[0] === 'DATA' ? [tab[0], tab[1], tab[2], DATA[ob.type][1]] : tab));
}

// The path above the panels (buttons_panel_context_draw): the data the tab edits, from the scene down, without the
// scene and view layer where an object's data is shown.
export function propertiesPath(context, tab) {
  const ob = context.object, sceneLevel = ['RENDER', 'OUTPUT', 'VIEW_LAYER', 'SCENE', 'WORLD'].includes(tab);
  const path = sceneLevel ? [context.scene] : [];
  if (tab === 'VIEW_LAYER') path.push(context.view_layer);
  if (tab === 'WORLD' && context.world) path.push(context.world);
  if (tab === 'COLLECTION') path.push(context.collection);
  if (!sceneLevel && tab !== 'COLLECTION' && tab !== 'TOOL' && ob) path.push(ob);
  if (tab === 'DATA' && ob?.data) path.push(ob.data);
  if (tab === 'MATERIAL' && context.material) path.push(context.material);
  if (tab === 'TEXTURE' && context.texture) path.push(context.texture);
  if (tab === 'MODIFIER' && ob?.modifiers.active) path.push(ob.modifiers.active);
  return path.filter(Boolean);
}
