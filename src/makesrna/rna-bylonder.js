// Bylonder's data under Blender's RNA (makesrna/intern/rna_*.cc): per struct, the properties Bylonder has, as
// { get(owner, r), set(owner, value, r) } or a bare getter for a read-only one. The rest read as Blender's defaults
// (rna.js). Values are in Blender's axes (Z up, right-handed): Babylon's (x, y, z) is Blender's (x, z, y).
// A write is RNA's set and update: it changes Bylonder's data and calls host.update (the notifier); undo steps are
// pushed by the UI that made the edit (host.undoPush), as Blender's buttons push them, never by RNA.
//   host: { world (runtime/world.js), selection (editors/object/selection.js), preferences,
//           update(struct, name, owner), undoPush(name) }
import { Camera, Light, Quaternion } from '@babylonjs/core';
import { rna, collection } from './rna.js';
import modifierTypes from './rna-modifiers.json' with { type: 'json' };
import { modifierStack } from '../modifiers/stack.js';
import { deleted } from '../editors/object/identity.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../bmesh/intern/bmesh-marking.js';

// Swapping two axes is its own inverse and flips handedness.
const axes = ([x, y, z]) => [x, z, y];
// A Babylon rotation about its x, y, z is one about Blender's -X, -Z, -Y, applied z first: Blender's YXZ order.
const eulerFromBabylon = ({ x, y, z }) => [-x, -z, -y];
const eulerToBabylon = ([x, y, z]) => ({ x: -x, y: -z, z: -y });
const babylonQuaternion = (node) => node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
const babylonEuler = (node) => (node.rotationQuaternion ? node.rotationQuaternion.toEulerAngles() : node.rotation);
function setRotation(node, quaternion) {
  if (node.rotationQuaternion) node.rotationQuaternion.copyFrom(quaternion);
  else node.rotation.copyFrom(quaternion.toEulerAngles());
}

// A number or boolean array (bpy_prop_array): a copy whose elements write through, with x, y, z (or w, x, y, z).
function array(get, set, names = 'xyz') {
  const index = (key) => (key.length === 1 && names.includes(key) ? names.indexOf(key) : key);
  return {
    get: (owner, r) => new Proxy(get(owner, r), {
      get: (values, key) => values[typeof key === 'string' ? index(key) : key],
      set(values, key, value) {
        if (!set) return false;
        values[index(key)] = value;
        set(owner, [...values], r);
        return true;
      },
    }),
    set: set && ((owner, value, r) => set(owner, [...value], r)),
  };
}

const SELECT_BITS = [SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE];
const OBJECT_DATA = { MESH: 'Mesh' };
const objectType = (ob) => (ob instanceof Camera ? 'CAMERA' : ob instanceof Light ? 'LIGHT' : ob.metadata?.wbCreation?.text ? 'FONT'
  : ob.metadata?.wbCurve ? 'CURVE' : ob.getTotalVertices?.() > 0 ? 'MESH' : 'EMPTY');
const editing = (ob, r) => !!ob && r.world.editMode?.object === ob;
const editTotals = (ob, r) => (editing(ob, r) && r.world.editMode.stats) || { verts: [0], edges: [0], faces: [0] };

// Bylonder's modifier types that are Blender's keep their type; its own (Array as Geometry Nodes) are Nodes modifiers.
const modifierType = (modifier) => (modifierTypes.types[modifier.type] ? modifier.type : 'NODES');
const modifierStruct = (modifier) => modifierTypes.types[modifier.type]?.struct ?? 'NodesModifier';
const modifierFlag = (key) => ({ get: ({ modifier }) => modifier[key], set: ({ modifier }, value, r) => { modifier[key] = value; r.world.modifiers.refresh(); } });
// A Blender modifier's settings, stored by RNA identifier (`count`, `use_axis[0]`, see modifiers/blender.js).
function modifierValues({ node, modifier }) {
  const set = (path, value, r) => r.world.modifiers.set(node, modifier.id, path, value, { finish: false });
  const names = Object.keys(modifier.values).map((path) => path.replace(/\[\d+\]$/, ''));
  return Object.fromEntries([...new Set(names)].filter((name) => modifierTypes.types[modifier.type]?.properties[name]).map((name) => [name,
    name in modifier.values
      ? { get: () => modifier.values[name], set: (owner, value, r) => set(name, value, r) }
      : array(() => Object.keys(modifier.values).filter((path) => path.startsWith(name + '[')).map((path) => modifier.values[path]),
        (owner, values, r) => values.forEach((value, i) => set(`${name}[${i}]`, value, r)))]));
}

const STRUCTS = {
  Object: {
    name: { get: (ob) => ob.name, set: (ob, name) => { ob.name = name; } },
    type: objectType,
    mode: (ob, r) => (editing(ob, r) ? 'EDIT' : 'OBJECT'),
    data: (ob, r) => r.pointer(OBJECT_DATA[objectType(ob)], ob),
    location: array((ob) => axes(ob.position.asArray()), (ob, value) => ob.position.copyFromFloats(...axes(value))),
    rotation_mode: (ob) => (ob.rotationQuaternion ? 'QUATERNION' : 'YXZ'),
    rotation_euler: array((ob) => eulerFromBabylon(babylonEuler(ob)), (ob, value) => {
      const { x, y, z } = eulerToBabylon(value);
      setRotation(ob, Quaternion.FromEulerAngles(x, y, z));
    }),
    rotation_quaternion: array((ob) => { const q = babylonQuaternion(ob); return [q.w, -q.x, -q.z, -q.y]; },
      (ob, [w, x, y, z]) => setRotation(ob, new Quaternion(-x, -z, -y, w)), 'wxyz'),
    scale: array((ob) => axes(ob.scaling.asArray()), (ob, value) => ob.scaling.copyFromFloats(...axes(value))),
    parent: (ob, r) => (r.world.objects.includes(ob.parent) ? r.pointer('Object', ob.parent) : null),
    children: (ob, r) => collection(r.objects().filter((child) => child.parent === ob).map((child) => r.pointer('Object', child))),
    modifiers: (ob, r) => collection(modifierStack(ob).map((modifier) => r.pointer(modifierStruct(modifier), { node: ob, modifier }, modifier))),
    material_slots: (ob, r) => collection((r.world.materials?.slots(ob) ?? []).map((material, slot_index) =>
      rna('MaterialSlot', { name: material?.name ?? '', material: r.pointer('Material', material), slot_index }))),
    active_material: (ob, r) => r.pointer('Material', r.world.materials?.activeMaterial(ob)),
    hide_select: { get: (ob) => ob.isPickable === false, set: (ob, value) => { ob.isPickable = !value; } },
    hide_get: (ob) => () => !ob.isEnabled(false),
    hide_set: (ob, r) => (hide) => { ob.setEnabled(!hide); r.host.update?.('Object', 'hide', ob); },
    visible_get: (ob) => () => !deleted(ob) && ob.isEnabled() && ob.isVisible !== false,
    select_get: (ob, r) => () => !!r.host.selection?.has(ob),
    select_set: (ob, r) => (state) => { if (!!r.host.selection?.has(ob) !== !!state) r.host.selection?.toggle(ob, true); },
  },
  // Bylonder's objects hold their mesh: the Mesh is the object's.
  Mesh: {
    name: (ob) => ob.name,
    total_vert_sel: (ob, r) => editTotals(ob, r).verts[0],
    total_edge_sel: (ob, r) => editTotals(ob, r).edges[0],
    total_face_sel: (ob, r) => editTotals(ob, r).faces[0],
    count_selected_items: (ob, r) => () => { const t = editTotals(ob, r); return [t.verts[0], t.edges[0], t.faces[0]]; },
  },
  Material: { name: (material) => material.name },
  Modifier: (owner) => ({
    name: modifierFlag('name'),
    type: ({ modifier }) => modifierType(modifier),
    show_viewport: modifierFlag('showViewport'),
    show_render: modifierFlag('showRender'),
    ...modifierValues(owner),
  }),
  Scene: {
    name: { get: (world) => world.sceneSettings?.state.name ?? 'Scene', set: (world, name) => world.sceneSettings.set('name', name, false) },
    frame_current: { get: (world) => Math.round(world.animation.time.frame), set: (world, frame) => world.animation.time.configure({ frameCurrent: frame }, { record: false }) },
    ...Object.fromEntries([['frame_start', 'frameStart'], ['frame_end', 'frameEnd'], ['frame_step', 'frameStep'], ['use_preview_range', 'usePreviewRange'],
      ['frame_preview_start', 'framePreviewStart'], ['frame_preview_end', 'framePreviewEnd'], ['sync_mode', 'syncMode']].map(([name, key]) => [name, {
      get: (world) => world.animation.time.state[key], set: (world, value) => world.animation.time.configure({ [key]: value }, { record: false }) }])),
    camera: (world, r) => r.pointer('Object', world.sceneSettings?.camera()),
    objects: (world, r) => collection(r.objects().map((ob) => r.pointer('Object', ob))),
    use_gravity: { get: (world) => world.sceneSettings?.state.useGravity ?? true, set: (world, value) => world.sceneSettings.set('useGravity', value, false) },
    gravity: array((world) => axes(world.scene.gravity.asArray()), (world, value) => world.sceneSettings.set('gravity', axes(value), false)),
    render: (world, r) => r.pointer('RenderSettings', world),
    unit_settings: (world, r) => r.pointer('UnitSettings', world),
    tool_settings: (world, r) => r.pointer('ToolSettings', world),
  },
  ToolSettings: {
    mesh_select_mode: array((world) => SELECT_BITS.map((bit) => !!((world.editMode?.selectmode ?? SCE_SELECT_VERTEX) & bit)), (world, value) => {
      const mode = SELECT_BITS.reduce((mask, bit, i) => (value[i] ? mask | bit : mask), 0);
      if (mode && world.editMode) world.editMode.selectmode = mode;
    }, ''),
    use_keyframe_insert_auto: { get: (world) => world.animation.time.state.autoKey, set: (world, value) => world.animation.time.configure({ autoKey: !!value }, { record: false }) },
  },
  RenderSettings: {
    fps: { get: (world) => world.animation.time.state.fps, set: (world, fps) => world.animation.time.configure({ fps }, { record: false }) },
    ...Object.fromEntries([['resolution_x', 'resolutionX'], ['resolution_y', 'resolutionY'], ['resolution_percentage', 'resolutionPercentage'],
      ['use_motion_blur', 'useMotionBlur'], ['motion_blur_shutter', 'motionBlurShutter'], ['use_sequencer', 'useSequencer']].map(([name, key]) => [name, {
      get: (world) => world.renderSettings?.state.render[key], set: (world, value) => world.renderSettings.set('render.' + key, value, false) }])),
  },
  UnitSettings: Object.fromEntries([['system', 'system'], ['scale_length', 'scale'], ['use_separate', 'separate'], ['system_rotation', 'rotation'],
    ['length_unit', 'length']].map(([name, key]) => [name, {
    get: (world) => world.sceneSettings?.state.unitSettings[key], set: (world, value) => world.sceneSettings.set('unitSettings.' + key, value, false) }])),
  // A Graph Editor and a Dope Sheet (editors/animation/anim-editor.js): their space's flags, in the module (rna_space.cc).
  SpaceGraphEditor: {
    type: () => 'GRAPH_EDITOR',
    mode: (editor) => ['FCURVES', 'DRIVERS'][editor.area.settings.mode],
    ui_mode: (editor) => ['FCURVES', 'DRIVERS'][editor.area.settings.mode],
    show_handles: spaceFlag(1 << 2, true),
    use_only_selected_keyframe_handles: spaceFlag(1 << 9),
    show_seconds: spaceFlag(1 << 4),
    show_sliders: spaceFlag(1 << 7),
    show_cursor: spaceFlag(1 << 8, true),
    use_realtime_update: spaceFlag(1 << 11, true),
    use_normalization: spaceFlag(1 << 14),
    use_auto_normalization: spaceFlag(1 << 15, true),
    show_markers: spaceFlag(1 << 16),
    show_extrapolation: spaceFlag(1 << 17, true),
    use_auto_merge_keyframes: spaceFlag(1 << 1, true),
    has_ghost_curves: () => false,
    pivot_point: { get: (editor) => PIVOTS[editor.area.settings.around], set: (editor, value) => { editor.area.settings = { around: PIVOTS.indexOf(value) }; editor.changed(); } },
    dopesheet: (editor, r) => r.pointer('DopeSheet', editor),
  },
  SpaceDopeSheetEditor: {
    type: () => 'DOPESHEET_EDITOR',
    mode: (editor) => ACTION_MODES[editor.area.settings.mode],
    ui_mode: (editor) => ACTION_MODES[editor.area.settings.mode],
    show_sliders: spaceFlag(1 << 1),
    show_seconds: spaceFlag(1 << 2),
    use_auto_merge_keyframes: spaceFlag(1 << 4, true),
    show_pose_markers: spaceFlag(1 << 6),
    use_realtime_update: spaceFlag(1 << 10, true),
    use_marker_sync: spaceFlag(1 << 11),
    show_interpolation: spaceFlag(1 << 12),
    show_extremes: spaceFlag(1 << 13),
    show_markers: spaceFlag(1 << 14),
    dopesheet: (editor, r) => r.pointer('DopeSheet', editor),
  },
  DopeSheet: {
    show_only_selected: dopesheetFilter(1 << 0),
    show_hidden: dopesheetFilter(1 << 26),
    show_only_errors: dopesheetFilter(1 << 28),
  },
  // A 3D Viewport (space_view3d/view3d.js): its shading, overlays and view.
  SpaceView3D: {
    type: () => 'VIEW_3D',
    shading: (view, r) => r.pointer('View3DShading', view),
    overlay: (view, r) => r.pointer('View3DOverlay', view),
    region_3d: (view, r) => r.pointer('RegionView3D', view),
  },
  View3DShading: {
    type: { get: (view) => SHADING[view.state.shading], set: (view, type) => setViewState(view, 'shading', Object.keys(SHADING).find((id) => SHADING[id] === type)) },
    show_xray: { get: (view) => !!view.state.xray, set: (view, value) => setViewState(view, 'xray', !!value) },
  },
  View3DOverlay: { show_overlays: { get: (view) => view.state.overlays, set: (view, value) => setViewState(view, 'overlays', !!value) } },
  RegionView3D: {
    view_perspective: (view) => (view.state.cameraView ? 'CAMERA' : view.editorCamera?.mode === Camera.ORTHOGRAPHIC_CAMERA ? 'ORTHO' : 'PERSP'),
    is_perspective: (view) => view.editorCamera?.mode !== Camera.ORTHOGRAPHIC_CAMERA,
  },
};
const SHADING = { wire: 'WIREFRAME', solid: 'SOLID', rendered: 'RENDERED' };
// A flag of an animation editor's space (eGraphEdit_Flag, eSAction_Flag), and of its dope sheet's filters; `inverted`
// for a property that is on when the flag is off (show_handles is !SIPO_NOHANDLES).
function spaceFlag(bit, inverted = false) {
  return {
    get: (editor) => !!(editor.area.settings.flag & bit) !== inverted,
    set: (editor, value) => { const { flag } = editor.area.settings; editor.area.settings = { flag: !!value !== inverted ? flag | bit : flag & ~bit }; editor.changed(); },
  };
}
function dopesheetFilter(bit) {
  return {
    get: (editor) => !!(editor.area.settings.filterflag & bit),
    set: (editor, value) => { const { filterflag } = editor.area.settings; editor.area.settings = { filterflag: value ? filterflag | bit : filterflag & ~bit }; editor.changed(); },
  };
}
const PIVOTS = ['BOUNDING_BOX_CENTER', 'CURSOR', 'INDIVIDUAL_ORIGINS'];
const ACTION_MODES = ['ACTION', 'SHAPEKEY', 'GPENCIL', 'DOPESHEET', 'MASK', 'CACHEFILE', 'TIMELINE'];
function setViewState(view, key, value) {
  if (value === undefined) throw TypeError(`bpy_struct: invalid ${key}`);
  if (key === 'shading' && view.setShading) return view.setShading(value);
  view.state[key] = value;
  view.sync?.();
}

// The RNA of one host's data: pointer(struct, owner) is the struct over a Bylonder owner (None for none), one per owner
// so scripts see the same struct each time; `key` is the owner's identity when the owner is made per call.
export function createRNA(host) {
  const cache = new WeakMap();
  const r = {
    host,
    world: host.world,
    objects: () => host.world.objects.filter((ob) => !deleted(ob)),
    pointer(struct, owner, key = owner) {
      if (!owner || !struct) return null;
      const structs = cache.get(key) ?? cache.set(key, new Map()).get(key);
      if (!structs.has(struct)) structs.set(struct, bind(struct, owner));
      return structs.get(struct);
    },
  };
  function bind(struct, owner) {
    const bindings = STRUCTS[struct] ?? STRUCTS[struct.endsWith('Modifier') ? 'Modifier' : null] ?? {};
    const table = typeof bindings === 'function' ? bindings(owner) : bindings, data = {};
    for (const [name, binding] of Object.entries(table)) {
      const { get, set } = typeof binding === 'function' ? { get: binding } : binding;
      Object.defineProperty(data, name, {
        enumerable: true,
        get: () => get(owner, r),
        set: set && ((value) => { set(owner, value, r); host.update?.(struct, name, owner); }),
      });
    }
    return rna(struct, data);
  }
  return r;
}

// What layout.prop shows (editors/interface/ui-layout.js, as `ui.prop`): a bound boolean as a check item whose edit is an
// undo step.
export const propBinding = (host) => (data, name) => {
  if (!data || typeof data[name] !== 'boolean' || !Object.getOwnPropertyDescriptor(Object(data), name)?.set) return null;
  const label = name.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  return { label, get: () => data[name], set: (value) => { data[name] = value; host.undoPush?.(label); } };
};
