import { parseNumber } from './numeric.js';
// Scene > Units (Blender scene.unit_settings). One shared object read by every property row; 1 Babylon unit = 1 m before Unit Scale.
export const unitSettings = { system: 'METRIC', scale: 1, separate: false, rotation: 'DEGREES', length: 'ADAPTIVE' };
export const unitDefaults = { ...unitSettings };
const tables = {
  METRIC: [['KILOMETERS', 'Kilometers', 'km', 1000], ['METERS', 'Meters', 'm', 1], ['CENTIMETERS', 'Centimeters', 'cm', 0.01], ['MILLIMETERS', 'Millimeters', 'mm', 0.001], ['MICROMETERS', 'Micrometers', 'µm', 1e-6]],
  IMPERIAL: [['MILES', 'Miles', 'mi', 1609.344], ['FEET', 'Feet', 'ft', 0.3048], ['INCHES', 'Inches', 'in', 0.0254], ['THOU', 'Thousandth', 'thou', 0.0000254]],
};
const base = { METRIC: 'METERS', IMPERIAL: 'FEET' };
export const lengthUnitOptions = system => Object.fromEntries([['Adaptive', 'ADAPTIVE'], ...(tables[system] || []).map(([id, label]) => [label, id])]);
// Blender resets the length unit to the system's base unit when the system changes (rna_UnitSettings_system_update).
export const baseLengthUnit = system => base[system] || 'ADAPTIVE';
const trim = n => String(Number(n.toFixed(Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 3 : 4)));
const pick = (table, meters) => unitSettings.length === 'ADAPTIVE' ? table.find(([, , , f]) => Math.abs(meters) >= f * 0.9999) || table.at(-1) : table.find(([id]) => id === unitSettings.length) || table[0];
export function formatLength(value) {
  const table = tables[unitSettings.system];
  if (!table) return trim(value);
  const meters = value * unitSettings.scale;
  if (meters === 0) return '0 ' + table.find(([id]) => id === (unitSettings.length === 'ADAPTIVE' ? base[unitSettings.system] : unitSettings.length))[2];
  const [, , symbol, factor] = pick(table, meters), n = meters / factor;
  if (!unitSettings.separate) return trim(n) + ' ' + symbol;
  const index = table.findIndex(([, , s]) => s === symbol), next = table[index + 1], whole = Math.trunc(n), rest = (n - whole) * factor;
  return !next || Math.abs(rest) < 1e-9 ? trim(n) + ' ' + symbol : whole + ' ' + symbol + ' ' + trim(rest / next[3]) + ' ' + next[2];
}
export const formatAngle = value => unitSettings.rotation === 'RADIANS' ? trim(value) : trim(value * 180 / Math.PI) + '°';
export function format(value, unit) { return unit === 'length' ? formatLength(value) : unit === 'angle' ? formatAngle(value) : trim(value); }
// Unitless input uses the displayed unit (adaptive: the system base unit); explicit units always convert.
export function parse(text, unit) {
  if (unit === 'angle') return parseNumber(text, unit, { implicit: unitSettings.rotation === 'RADIANS' ? 1 : Math.PI / 180 });
  if (unit !== 'length' || !tables[unitSettings.system]) return parseNumber(text, unit);
  const id = unitSettings.length === 'ADAPTIVE' ? base[unitSettings.system] : unitSettings.length;
  return parseNumber(text, unit, { implicit: tables[unitSettings.system].find(([key]) => key === id)[3] }) / unitSettings.scale;
}
export const editText = (value, unit) => unit === 'length' || unit === 'angle' ? format(value, unit) : String(value);
