// Writes modifier settings into a ModifierData in the module's memory, by the DNA layout of each RNA property
// (dna-modifiers.json). Shared by the app (blender.js) and the modifier kernels polyfill, which gets the layouts with
// the exported stack instead of Blender's RNA and DNA tables.

// The layout of one RNA property's DNA field: offset, size, kind, signedness, flag bit (a bit set's first), whether
// the flag is negated, the property's default, whether it is a boolean, and an enum's item values by identifier.
export const fieldLayout = (located, prop) => ({
  ...located,
  default: prop.default,
  boolean: prop.type === 'BOOLEAN',
  ...(prop.type === 'ENUM' && { items: Object.fromEntries(prop.items.map((item) => [item[0], item[3]])) }),
});

// Writes a value into a field at a struct's address: a bit of a flag field, an element of an array, an enum by its
// item's identifier, or a number.
function writeField(view, address, layout, value, index) {
  const { offset, size, kind, signed, bit, bitset, negative, boolean, items } = layout;
  const at = address + offset + (bitset ? 0 : index * size);
  const type = { 1: signed ? 'Int8' : 'Uint8', 2: signed ? 'Int16' : 'Uint16', 4: signed ? 'Int32' : 'Uint32' }[size];
  if (kind === 'float') return view.setFloat32(at, value, true);
  if (bit !== undefined && boolean) {
    const mask = bitset ? bit << index : bit, on = negative ? !value : value;
    const word = view[`get${type}`](at, true);
    return view[`set${type}`](at, on ? word | mask : word & ~mask, true);
  }
  view[`set${type}`](at, items ? items[value] : Number(value), true);
}

// Settings by path (`count`, `use_axis[0]`) through their properties' layouts; paths without one are left alone.
// Properties that are one field in two units (Bevel's `width` and `width_pct`) are written defaults first, so the
// one set away from its default is the field's value.
export function writeValues(view, address, layouts, values) {
  const entries = Object.entries(values).map(([path, value]) => {
    const [, prop, index] = path.match(/^(\w+)(?:\[(\d+)\])?$/);
    return { layout: layouts[prop], value, index: Number(index ?? 0) };
  }).filter(({ layout }) => layout);
  const changed = ({ layout, value, index }) => value !== (Array.isArray(layout.default) ? layout.default[index] : layout.default);
  for (const entry of [...entries.filter((e) => !changed(e)), ...entries.filter(changed)]) writeField(view, address, entry.layout, entry.value, entry.index);
}

// A field's value at a struct's address, as writeField writes it.
function readField(view, address, layout, index) {
  const { offset, size, kind, signed, bit, bitset, negative, boolean, items } = layout;
  const at = address + offset + (bitset ? 0 : index * size);
  const type = { 1: signed ? 'Int8' : 'Uint8', 2: signed ? 'Int16' : 'Uint16', 4: signed ? 'Int32' : 'Uint32' }[size];
  if (kind === 'float') return view.getFloat32(at, true);
  const word = view[`get${type}`](at, true);
  if (bit !== undefined && boolean) return !!(word & (bitset ? bit << index : bit)) !== !!negative;
  return items ? Object.keys(items).find((id) => items[id] === word) ?? null : word;
}

// The settings at paths (as writeValues takes them) that a struct at an address holds.
export function readValues(view, address, layouts, paths) {
  return Object.fromEntries(paths.flatMap((path) => {
    const [, prop, index] = path.match(/^(\w+)(?:\[(\d+)\])?$/);
    return layouts[prop] ? [[path, readField(view, address, layouts[prop], Number(index ?? 0))]] : [];
  }));
}
