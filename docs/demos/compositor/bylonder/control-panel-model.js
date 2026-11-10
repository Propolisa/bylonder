// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The control panel's model: a scene's controls (blend-scene.js) laid out as Blender's UI would show them. Rows are a
// control or a vector's components under Blender's name for the property; groups are the IDs and the structs within
// them (a node, a bone, a modifier); sections put custom properties first, then materials, then the rest. Values are
// shown and typed in Blender's units, dragged and snapped at a scale fit for their range.

/** @typedef {import('./blend-scene.js').Control} Control */
/** @typedef {import('./blend-scene.js').Value} Value */
/** @typedef {'number' | 'slider' | 'color' | 'check' | 'text' | 'enum'} Widget */
/**
 * @typedef {object} Row
 * @property {string} key the property's path, a vector's without its index
 * @property {string} label
 * @property {Control[]} controls in component order
 * @property {Widget} widget
 * @property {string[]} [items] an enum's choices
 */
/**
 * An ID or a struct within one: its rows and its own groups.
 * @typedef {object} Group
 * @property {string} key its path
 * @property {string} title
 * @property {string} [kind] what it is: the bpy.data collection of an ID, or the collection holding a struct (`nodes`)
 * @property {Row[]} rows
 * @property {Group[]} groups
 */
/** @typedef {{ key: string, title: string, groups: Group[] }} Section */

const STEP = /\.(\w+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g;
const ID = /^(\w+)\["((?:[^"\\]|\\.)*)"\]/;
const unquote = (/** @type {string} */ key) => key.replace(/\\(.)/g, '$1');

/**
 * A path's parts: its ID (`objects`, `Cube`), the struct within it holding the property (`pose.bones["Arm"]`) with the
 * name and collection of the struct's last named step, the property (a custom property's key) and a vector's index.
 * @param {string} path
 */
export function parsePath(path) {
  const id = ID.exec(path);
  if (!id) return null;
  const steps = [...path.slice(id[0].length).matchAll(STEP)].map(([, name, index, key]) => ({ name, index: index === undefined ? undefined : Number(index), key: key === undefined ? undefined : unquote(key) }));
  const index = steps.length > 1 && steps.at(-1)?.index !== undefined ? steps.pop()?.index : undefined;
  const last = steps.pop();
  const custom = last?.key !== undefined;
  const at = steps.map((s) => s.key !== undefined).lastIndexOf(true);
  const struct = steps.slice(0, at + 1);
  const text = (/** @type {typeof steps} */ list) => list.map((s) => (s.name !== undefined ? `.${s.name}` : s.index !== undefined ? `[${s.index}]` : `["${s.key}"]`)).join('');
  return {
    collection: id[1], name: unquote(id[2]), idPath: id[0],
    struct: at < 0 ? '' : text(struct), structName: at < 0 ? undefined : struct[at].key, structKind: at < 1 ? undefined : struct[at - 1].name,
    property: custom ? /** @type {string} */ (last?.key) : last?.name ?? String(last?.index), custom, index,
  };
}

/** Blender's identifier as a name (`clip_start`: Clip Start). @param {string} identifier */
const titled = (identifier) => identifier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** A control's name as Blender's UI shows it. @param {Control} control */
export const labelOf = (control) => control.name ?? titled(parsePath(control.path)?.property ?? control.path);

const COMPONENTS = { QUATERNION: 'WXYZ', AXISANGLE: 'WXYZ', COLOR: 'RGBA', COLOR_GAMMA: 'RGBA' };
/** A vector component's letter, as Blender labels it by the property's subtype. @param {Control} control @param {number} index */
export const componentLabel = (control, index) => (/** @type {Record<string, string>} */ (COMPONENTS)[control.subtype ?? ''] ?? 'XYZW')[index] ?? String(index);

/**
 * The widget a row draws as: a color's swatch, a factor's slider, a checkbox, a dropdown of choices, a text field, else
 * a number field.
 * @param {Control[]} controls
 * @param {string[]} [items]
 * @returns {Widget}
 */
function widgetOf(controls, items) {
  const [first] = controls;
  if (items) return 'enum';
  if (first.type === 'BOOLEAN') return 'check';
  if (first.type === 'STRING') return 'text';
  if ((first.subtype === 'COLOR' || first.subtype === 'COLOR_GAMMA') && controls.length >= 3) return 'color';
  if (first.subtype === 'FACTOR' || first.subtype === 'PERCENTAGE') return 'slider';
  return 'number';
}

// The order of the rest's sections, by bpy.data collection, and their titles.
const KINDS = ['objects', 'lights', 'cameras', 'worlds', 'scenes', 'node_groups'];
const TITLES = /** @type {Record<string, string>} */ ({ custom: 'Custom Properties', materials: 'Materials', objects: 'Objects', lights: 'Lights', cameras: 'Cameras', worlds: 'World', scenes: 'Scene', node_groups: 'Node Groups' });
// Materials Blender names itself, after those the author named.
const UNNAMED = /^Material(\.\d+)?$/;

/**
 * The panel's sections of these controls: custom properties first, then the materials, then the rest by kind.
 * `images`: a control setting an image (a URL of the package) as a choice of the package's images.
 * @param {Control[]} controls
 * @param {(control: Control) => boolean} [isImage]
 * @returns {Section[]}
 */
export function layout(controls, isImage = () => false) {
  const images = [...new Set(controls.filter(isImage).map((c) => String(c.default)))];
  /** @type {Map<string, Section>} */
  const sections = new Map();
  /** @type {Map<string, Group>} */
  const groups = new Map();
  /** @type {Map<string, Row>} */
  const rows = new Map();
  for (const control of controls) {
    const parts = parsePath(control.path);
    if (!parts) continue;
    const sectionKey = parts.custom ? 'custom' : parts.collection;
    let section = sections.get(sectionKey);
    if (!section) sections.set(sectionKey, section = { key: sectionKey, title: TITLES[sectionKey] ?? titled(sectionKey), groups: [] });
    const idKey = `${sectionKey} ${parts.idPath}`;
    let group = groups.get(idKey);
    if (!group) {
      groups.set(idKey, group = { key: parts.idPath, title: parts.name, kind: parts.collection, rows: [], groups: [] });
      section.groups.push(group);
    }
    if (parts.structName !== undefined) {
      const structKey = `${idKey}${parts.struct}`;
      let struct = groups.get(structKey);
      if (!struct) {
        groups.set(structKey, struct = { key: parts.idPath + parts.struct, title: parts.structName, kind: parts.structKind, rows: [], groups: [] });
        group.groups.push(struct);
      }
      group = struct;
    }
    const rowKey = parts.index === undefined ? control.path : control.path.replace(/\[\d+\]$/, '');
    const row = rows.get(rowKey);
    if (row) row.controls.push(control);
    else {
      const made = { key: rowKey, label: parts.custom ? parts.property : labelOf(control), controls: [control], widget: /** @type {Widget} */ ('number'), ...(isImage(control) && { items: images }) };
      rows.set(rowKey, made);
      group.rows.push(made);
    }
  }
  for (const row of rows.values()) row.widget = widgetOf(row.controls, row.items);
  const materials = sections.get('materials');
  materials?.groups.sort((a, b) => Number(UNNAMED.test(a.title)) - Number(UNNAMED.test(b.title)));
  const rank = (/** @type {string} */ key) => (key === 'custom' ? -2 : key === 'materials' ? -1 : KINDS.includes(key) ? KINDS.indexOf(key) : KINDS.length);
  return [...sections.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/** Whether two values are the same, as Blender stores a float (single precision). @param {Value} a @param {Value} b */
const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)));

/**
 * Whether a row holds Blender's defaults: every component at the value Blender gives it new. A control whose default
 * is not known (a custom property) is never at it.
 * @param {Row} row
 * @param {(path: string) => Value} value
 */
export const atDefault = (row, value) => row.controls.every((c) => c.blender_default !== undefined && same(value(c.path), c.blender_default));

/**
 * Whether a row matches a search: every word of it in the row's label, its group's titles or its path.
 * @param {Row} row
 * @param {string[]} titles
 * @param {string} query
 */
export function matches(row, titles, query) {
  const text = [row.label, ...titles, row.key].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

const UNITS = /** @type {Record<string, string>} */ ({ LENGTH: 'm', CAMERA: 'mm', POWER: 'W', MASS: 'kg', VELOCITY: 'm/s', ACCELERATION: 'm/s²', TEMPERATURE: 'K' });
const DEGREES = 180 / Math.PI;
const isRotation = (/** @type {Control} */ c) => c.unit === 'ROTATION' || c.subtype === 'ANGLE' || c.subtype === 'EULER';
const isPercentage = (/** @type {Control} */ c) => c.subtype === 'PERCENTAGE';

/** A value as Blender's UI shows it: in degrees for a rotation, with its unit, to its precision. @param {Value} value @param {Control} control */
export function formatValue(value, control) {
  if (typeof value !== 'number') return String(value);
  if (control.type === 'INT') return String(Math.round(value));
  const digits = Math.min(control.precision ?? 3, 5);
  const trimmed = (/** @type {number} */ v) => String(Number(v.toFixed(digits)) || 0);
  if (isRotation(control)) return `${Number((value * DEGREES).toFixed(1)) || 0}°`;
  if (isPercentage(control)) return `${trimmed(value)}%`;
  const unit = control.unit && UNITS[control.unit];
  return unit ? `${trimmed(value)} ${unit}` : (Number(value.toFixed(Math.min(digits, 3))) || 0).toFixed(Math.min(digits, 3));
}

// Units a typed value may carry, as factors of the control's own (a length in meters, an angle in radians).
const LENGTHS = /** @type {Record<string, number>} */ ({ km: 1000, m: 1, cm: 0.01, mm: 0.001, um: 1e-6 });

/**
 * A typed value: a number or arithmetic (`+ - * / ^`, parentheses, `pi`), with units (`cm`, `°`, `deg`), in the
 * control's own units (a rotation is typed in degrees, as Blender's field takes it, and set in radians). Null when it does
 * not read.
 * @param {string} text
 * @param {Control} control
 * @returns {number | null}
 */
export function parseValue(text, control) {
  const rotation = isRotation(control), length = control.unit === 'LENGTH';
  const tokens = text.trim().toLowerCase().match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-zµ°]+|[-+*/^()]/g) ?? [];
  let at = 0;
  const peek = () => tokens[at], next = () => tokens[at++];
  /** @returns {number} */
  const primary = () => {
    const token = next();
    if (token === '(') { const v = sum(); if (next() !== ')') throw Error(); return v; }
    if (token === '-') return -power();
    if (token === '+') return power();
    if (token === 'pi') return Math.PI;
    const number = Number(token);
    if (token === undefined || Number.isNaN(number)) throw Error();
    const unit = peek();
    if (unit === '°' || unit === 'deg') { at++; return number; }
    if (unit === 'rad') { at++; return rotation ? number * DEGREES : number; }
    if (unit && unit in LENGTHS) { at++; return length ? number * LENGTHS[unit] : number; }
    return number;
  };
  /** @returns {number} */
  const power = () => { const base = primary(); if (peek() === '^') { at++; return base ** power(); } return base; };
  const product = () => { let v = power(); while (peek() === '*' || peek() === '/') v = next() === '*' ? v * power() : v / power(); return v; };
  const sum = () => { let v = product(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + product() : v - product(); return v; };
  try {
    const value = sum();
    if (at !== tokens.length || !Number.isFinite(value)) return null;
    return clamp(rotation ? value / DEGREES : value, control);
  } catch {
    return null;
  }
}

/** A value within the control's hard range, whole for an integer. @param {number} value @param {Control} control */
export function clamp(value, control) {
  const v = Math.min(control.hard_max ?? Infinity, Math.max(control.hard_min ?? -Infinity, value));
  return control.type === 'INT' ? Math.round(v) : v;
}

/** The control's soft range when it is a usable one (a slider's track), else null. @param {Control} control */
export function softRange(control) {
  const min = control.soft_min ?? control.hard_min, max = control.soft_max ?? control.hard_max;
  return min !== undefined && max !== undefined && max > min && max - min <= 1e4 ? [min, max] : null;
}

/**
 * How much a pixel of drag changes the control: a span of its soft range over a field's travel when the range is
 * small, else a step of its own (RNA's step is a hundredth of the value); a rotation by half a degree.
 * @param {Control} control
 */
export function dragScale(control) {
  if (isRotation(control)) return 0.5 / DEGREES;
  const range = softRange(control);
  if (control.type === 'INT') return range && range[1] - range[0] <= 100 ? (range[1] - range[0]) / 200 : 1 / 8;
  if (range && range[1] - range[0] <= 100) return (range[1] - range[0]) / 300;
  return (control.step ?? 10) / 1000;
}

/**
 * How much a finger's swipe across a number field changes the control: a small soft range, half a turn for a rotation,
 * else the value's own size (at least 300 pixels of a mouse drag), so a swipe moves it usefully on a small screen.
 * @param {Control} control
 * @param {number} value
 */
export function touchSpan(control, value) {
  if (isRotation(control)) return Math.PI;
  const range = softRange(control);
  return range && range[1] - range[0] <= 100 ? range[1] - range[0] : Math.max(Math.abs(value), dragScale(control) * 300);
}

/**
 * The increment Ctrl snaps a drag to: 5 degrees for a rotation (1 with Shift); by a small soft range's span a tenth,
 * 1 or 10, else RNA's step (its hundredths, a hundred pixels of drag); a tenth of it with Shift; at least 1 for an integer.
 * @param {Control} control
 * @param {boolean} fine
 */
export function snapStep(control, fine) {
  if (isRotation(control)) return (fine ? 1 : 5) / DEGREES;
  const range = softRange(control), span = range ? range[1] - range[0] : Infinity;
  const step = span <= 2.1 ? 0.1 : span <= 21 ? 1 : span <= 100 ? 10 : (control.step ?? 10);
  return control.type === 'INT' ? Math.max(1, fine ? step / 10 : step) : fine ? step / 10 : step;
}

/** A value snapped to a step. @param {number} value @param {number} step */
export const snapped = (value, step) => Number((Math.round(value / step) * step).toPrecision(12));

/** A linear color component as the display shows it (sRGB's encoding), 0 to 1. @param {number} v */
export const toDisplay = (v) => { const c = Math.min(1, Math.max(0, v)); return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; };
/** A display (sRGB) component as linear. @param {number} v */
export const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// sRGB bytes in linear light, to average colours as light mixes.
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

/**
 * What each id of an ID pass covers (0 to 1) and the average colour it shows there (CSS), from the ID pass's pixels
 * (an id in the red and green bytes, 0 for none) and the frame's at the same size, RGBA bytes both.
 * @param {ArrayLike<number>} ids
 * @param {ArrayLike<number>} shown
 */
export function seen(ids, shown) {
  /** Each id's pixel count and summed linear colour. @type {Map<number, number[]>} */
  const sums = new Map();
  for (let i = 0; i < ids.length; i += 4) {
    const id = ids[i] + (ids[i + 1] << 8);
    if (!id) continue;
    let sum = sums.get(id);
    if (!sum) sums.set(id, sum = [0, 0, 0, 0]);
    sum[0]++;
    for (let c = 0; c < 3; c++) sum[c + 1] += LINEAR[shown[i + c]];
  }
  const pixels = ids.length / 4;
  return new Map([...sums].map(([id, [count, ...rgb]]) => [id, { share: count / pixels, colour: `rgb(${rgb.map((v) => Math.round(toDisplay(v / count) * 255)).join(' ')})` }]));
}

/**
 * A material's main colour where it is not seen: its first Base Color row, else its first Color row.
 * @param {Group} group
 * @returns {Row | undefined}
 */
export function baseColor(group) {
  /** @param {Group} g @returns {Row[]} */
  const colors = (g) => [...g.rows.filter((r) => r.widget === 'color'), ...g.groups.flatMap(colors)];
  const found = colors(group);
  return found.find((r) => r.label === 'Base Color') ?? found.find((r) => r.label === 'Color');
}

/** A color component as the screen shows it, from linear (gamma for COLOR_GAMMA). @param {number} v @param {boolean} gamma */
export const displayOf = (v, gamma) => (gamma ? Math.min(1, Math.max(0, v)) : toDisplay(v));
/** A color component as stored, from how the screen shows it. @param {number} v @param {boolean} gamma */
export const storedOf = (v, gamma) => (gamma ? v : toLinear(v));
/** A color's hex, from its components as stored. @param {number[]} rgb @param {boolean} gamma */
export const hexOf = (rgb, gamma) => `#${rgb.slice(0, 3).map((v) => Math.round(displayOf(v, gamma) * 255).toString(16).padStart(2, '0')).join('')}`;
/** A hex color as components to store, or null where it is not one. @param {string} hex @param {boolean} gamma */
export const rgbOf = (hex, gamma) => (/^#?[\da-f]{6}$/i.test(hex.trim()) ? [0, 2, 4].map((i) => storedOf(parseInt(hex.trim().replace('#', '').slice(i, i + 2), 16) / 255, gamma)) : null);

/** A displayed color's hue, saturation and value, each 0 to 1, as Blender's color picker has them. @param {number[]} rgb */
export function hsvOf([r, g, b]) {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, max ? d / max : 0, max];
}

/** A hue, saturation and value as a displayed color. @param {number[]} hsv */
export function rgbOfHsv([h, s, v]) {
  const channel = (/** @type {number} */ n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [channel(5), channel(3), channel(1)];
}
