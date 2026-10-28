// The sidebar's Item > Transform panel, which Blender draws in C (view3d_buttons.cc): view3d_panel_transform and the
// functions it calls, ported as the layout calls they make, so the panel draws through the same layout as Blender's
// Python panels. Object Mode (v3d_transform_butsR, v3d_object_dimension_buts); Edit Mode's Median panel
// (v3d_editvertex_buts) is not ported yet.
import { kw } from '../../windowmanager/wm-operators.js';

// v3d_transform_butsR: location, rotation (per rotation mode), the rotation mode and scale, each with its locks.
function v3d_transform_butsR(layout, ob) {
  const locked = (split, property, prop) => {
    let colsub = split.column(kw({ align: true }));
    colsub.prop(ob, prop, ...(property ? [kw({ text: property })] : []));
    colsub = split.column(kw({ align: true }));
    colsub.emboss = 'NONE_OR_STATUS';
    colsub.label(kw({ text: '' }));
    return colsub;
  };
  locked(layout.split(kw({ factor: 0.8 })), null, 'location').prop(ob, 'lock_location', kw({ toggle: true, icon_only: true, text: '', icon: 'DECORATE_UNLOCKED' }));
  const split = layout.split(kw({ factor: 0.8 }));
  const rotation = { QUATERNION: 'rotation_quaternion', AXIS_ANGLE: 'rotation_axis_angle' }[ob.rotation_mode] ?? 'rotation_euler';
  if (rotation === 'rotation_euler') {
    locked(split, 'Rotation', rotation).prop(ob, 'lock_rotation', kw({ toggle: true, icon_only: true, text: '', icon: 'DECORATE_UNLOCKED' }));
  } else {
    let colsub = split.column(kw({ align: true }));
    colsub.prop(ob, rotation, kw({ text: 'Rotation' }));
    colsub = split.column(kw({ align: true }));
    colsub.emboss = 'NONE_OR_STATUS';
    colsub.prop(ob, 'lock_rotations_4d', kw({ toggle: true, text: '4L' }));
    if (ob.lock_rotations_4d) colsub.prop(ob, 'lock_rotation_w', kw({ toggle: true, icon_only: true, text: '', icon: 'DECORATE_UNLOCKED' }));
    else colsub.label(kw({ text: '' }));
    colsub.prop(ob, 'lock_rotation', kw({ toggle: true, icon_only: true, text: '', icon: 'DECORATE_UNLOCKED' }));
  }
  layout.prop(ob, 'rotation_mode', kw({ text: '' }));
  locked(layout.split(kw({ factor: 0.8 })), null, 'scale').prop(ob, 'lock_scale', kw({ toggle: true, icon_only: true, text: '', icon: 'DECORATE_UNLOCKED' }));
}

// v3d_object_dimension_buts: Blender draws "Dimensions:" and X, Y, Z number buttons of the evaluated bounding box,
// which Object.dimensions gives.
function v3d_object_dimension_buts(layout, ob) {
  layout.prop(ob, 'dimensions');
}

// OB_TYPE_SUPPORT_EDITMODE, and the types that show dimensions besides.
const DIMENSIONED = new Set(['MESH', 'CURVE', 'SURFACE', 'FONT', 'META', 'ARMATURE', 'LATTICE', 'GREASEPENCIL', 'VOLUME', 'CURVES', 'POINTCLOUD']);

// The panel type as view3d_buttons_register registers it.
export const VIEW3D_PT_transform = Object.assign(function () { return Object.create(VIEW3D_PT_transform); }, {
  bl_idname: 'VIEW3D_PT_transform', bl_label: 'Transform', bl_space_type: 'VIEW_3D', bl_region_type: 'UI', bl_category: 'Item',
  // view3d_panel_transform_poll: an active object; not in Edit Mode until its Median panel is ported.
  poll: (context) => !!context.active_object && context.mode === 'OBJECT',
  draw(context) {
    const ob = context.active_object, col = this.layout.column();
    v3d_transform_butsR(col, ob);
    if (DIMENSIONED.has(ob.type)) v3d_object_dimension_buts(col, ob);
  },
});
