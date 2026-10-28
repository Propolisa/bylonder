// Curve and Text data under Blender's RNA (rna_curve.cc), over a curve or text object's Curve data
// (blenkernel/curve/curve.js): its settings, splines and points, text, character formats, text boxes and fonts.
// A write goes through world.curves.update, which re-evaluates the object (and the edit data in Edit Mode).
import curveRNA from './rna-curves.json' with { type: 'json' };
import { settingNames, splineFlags } from '../blenkernel/curve/curve.js';
import { collection } from './rna.js';

const data = (node, r) => r.world.curves.data(node);
const update = (node, r, fn) => r.world.curves.update(node, fn);
const FORMAT_BITS = { use_bold: 1, use_italic: 2, use_underline: 4, use_small_caps: 16 };
const BOX_FIELDS = ['x', 'y', 'width', 'height'];
const POINT_ARRAYS = ['co', 'handle_left', 'handle_right'];

// A setting by RNA identifier, Blender's default when the data has none.
const setting = (name, struct) => ({
  get: (node, r) => data(node, r).settings?.[name] ?? curveRNA[struct].properties[name]?.default,
  set: (node, value, r) => update(node, r, (d) => { d.settings = { ...d.settings, [name]: value }; }),
});
const settings = (type, struct) => Object.fromEntries(settingNames(type).filter((name) => curveRNA[struct].properties[name]).map((name) => [name, setting(name, struct)]));

// A pointer to another object, held by name.
const target = (name) => ({
  get: (node, r) => r.pointer('Object', r.world.curves.byName(data(node, r).targets?.[name])),
  set: (node, ob, r) => update(node, r, (d) => { d.targets = { ...d.targets, [name]: ob ? r.objects().find((n) => r.pointer('Object', n) === ob)?.name : undefined }; }),
});

const splines = (node, r) => collection((data(node, r).splines ?? []).map((_, index) => r.pointer('Spline', { node, index }, `${node.uniqueId}:${index}`)));

const curve = (type) => ({
  ...settings(type, 'Curve'),
  splines,
  bevel_object: target('bevel_object'),
  taper_object: target('taper_object'),
  is_editmode: (node, r) => r.world.editMode?.object === node,
});

export const curveStructs = {
  Curve: curve('CURVE'),
  TextCurve: {
    ...curve('FONT'),
    ...settings('FONT', 'TextCurve'),
    body: {
      get: (node, r) => data(node, r).text?.body ?? '',
      set: (node, body, r) => update(node, r, (d) => { d.text = { ...d.text, body, format: null, pos: [...body].length, selstart: 0, selend: 0 }; }),
    },
    body_format: (node, r) => collection([...(data(node, r).text?.body ?? '')].map((_, index) => r.pointer('TextCharacterFormat', { node, index }, `${node.uniqueId}:c${index}`))),
    text_boxes: (node, r) => collection((data(node, r).text?.boxes ?? []).map((_, index) => r.pointer('TextBox', { node, index }, `${node.uniqueId}:b${index}`))),
    follow_curve: target('follow_curve'),
    font: (node, r) => r.pointer('VectorFont', { name: data(node, r).text?.fonts?.[0] ?? null }, data(node, r).text?.fonts?.[0] ?? 'builtin'),
  },
  VectorFont: { name: ({ name }) => name ?? 'Bfont Regular', filepath: ({ name }) => name ?? '<builtin>', is_builtin: ({ name }) => !name },
  Spline: ({ node, index }) => {
    const spline = (r) => data(node, r).splines[index];
    const write = (r, fn) => update(node, r, (d) => fn(d.splines[index]));
    const field = (name) => ({ get: (owner, r) => spline(r)[name], set: (owner, value, r) => write(r, (s) => { s[name] = value; }) });
    return {
      type: field('type'),
      order_u: field('order_u'), order_v: field('order_v'), resolution_u: field('resolution_u'), resolution_v: field('resolution_v'),
      material_index: field('material_index'), tilt_interpolation: field('tilt_interpolation'), radius_interpolation: field('radius_interpolation'),
      point_count_u: (owner, r) => spline(r).point_count_u, point_count_v: (owner, r) => spline(r).point_count_v,
      character_index: (owner, r) => spline(r).character_index,
      hide: field('hide'),
      ...Object.fromEntries(Object.entries(splineFlags).map(([name, [bit, key]]) => [name, {
        get: (owner, r) => !!(spline(r)[key] & bit),
        set: (owner, value, r) => write(r, (s) => { s[key] = value ? s[key] | bit : s[key] & ~bit; }),
      }])),
      bezier_points: (owner, r) => collection((spline(r).bezier_points ?? []).map((_, point) => r.pointer('BezierSplinePoint', { node, index, point }, `${node.uniqueId}:${index}:${point}`))),
      points: (owner, r) => collection((spline(r).points ?? []).map((_, point) => r.pointer('SplinePoint', { node, index, point }, `${node.uniqueId}:${index}:p${point}`))),
    };
  },
  BezierSplinePoint: (owner) => point(owner, 'bezier_points'),
  SplinePoint: (owner) => point(owner, 'points'),
  TextCharacterFormat: ({ node, index }) => {
    const format = (r) => data(node, r).text?.format?.[index] ?? [0, 0, 0];
    const write = (r, fn) => update(node, r, (d) => {
      const length = [...d.text.body].length;
      d.text = { ...d.text, format: Array.from({ length }, (_, i) => [...(d.text.format?.[i] ?? [0, 0, 0])]) };
      fn(d.text.format[index]);
    });
    return {
      ...Object.fromEntries(Object.entries(FORMAT_BITS).map(([name, bit]) => [name, {
        get: (owner, r) => !!(format(r)[0] & bit),
        set: (owner, value, r) => write(r, (f) => { f[0] = value ? f[0] | bit : f[0] & ~bit; }),
      }])),
      material_index: { get: (owner, r) => format(r)[1], set: (owner, value, r) => write(r, (f) => { f[1] = value; }) },
      kerning: { get: (owner, r) => format(r)[2], set: (owner, value, r) => write(r, (f) => { f[2] = value; }) },
    };
  },
  TextBox: ({ node, index }) => Object.fromEntries(BOX_FIELDS.map((name, i) => [name, {
    get: (owner, r) => data(node, r).text.boxes[index][i],
    set: (owner, value, r) => update(node, r, (d) => { d.text.boxes[index][i] = value; }),
  }])),
};

// A point's properties, with its coordinates as arrays that write through.
function point({ node, index, point: at }, collectionName) {
  const get = (r) => data(node, r).splines[index][collectionName][at];
  const write = (r, fn) => update(node, r, (d) => fn(d.splines[index][collectionName][at]));
  const props = Object.keys(curveRNA[collectionName === 'points' ? 'SplinePoint' : 'BezierSplinePoint'].properties);
  return Object.fromEntries(props.map((name) => [name, POINT_ARRAYS.includes(name)
    ? { get: (owner, r) => get(r)[name].slice(), set: (owner, value, r) => write(r, (p) => { p[name] = [...value]; }) }
    : { get: (owner, r) => get(r)[name], set: (owner, value, r) => write(r, (p) => { p[name] = value; }) }]));
}
