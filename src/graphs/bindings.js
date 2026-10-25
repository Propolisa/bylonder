import { address } from '../animation/model.js';

const PROPERTY = { Boolean: 0, Float: 1, Int: 2 };
const numeric = value => typeof value === 'number' || typeof value === 'boolean';
const components = value => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].filter(k => typeof value?.[k] === 'number');
const className = block => block.getClassName?.() || '';

const propStore = block => {
  const seen = new Set();
  const entries = [];
  for (let proto = Object.getPrototypeOf(block); proto; proto = Object.getPrototypeOf(proto))
    for (const entry of proto._propStore || [])
      if (!seen.has(entry.propertyName) && entry.propertyName in block && Object.values(PROPERTY).includes(entry.type)) {
        seen.add(entry.propertyName);
        entries.push(entry);
      }
  return entries;
};

const inputs = {
  material: graph => graph.getInputBlocks().filter(b => b.isUniform && !b.isSystemValue && b.value != null && !b.isConstant).map(b => ({ block: b, prop: 'value', label: b.name, min: b.min !== b.max ? b.min : undefined, max: b.min !== b.max ? b.max : undefined })),
  geometry: graph => graph.attachedBlocks.filter(b => className(b) === 'GeometryInputBlock' && !b.isContextual && b.value != null).map(b => ({ block: b, prop: 'value', label: b.name, min: b.min !== b.max ? b.min : undefined, max: b.min !== b.max ? b.max : undefined })),
  particles: graph => graph.attachedBlocks.filter(b => className(b) === 'ParticleInputBlock' && !b.isSystemSource && b.value != null).map(b => ({ block: b, prop: 'value', label: b.name })),
  render: graph => graph.attachedBlocks.flatMap(b => propStore(b).map(e => ({ block: b, prop: e.propertyName, label: b.name + ' › ' + e.displayName, min: e.options?.min, max: e.options?.max, integer: e.type === PROPERTY.Int }))),
};

const keyed = list => {
  const counts = new Map();
  return list.map(input => {
    const base = input.block.name + (input.prop === 'value' ? '' : '.' + input.prop);
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return { ...input, key: n ? base + '~' + n : base };
  });
};

export function graphFields(graph, kind) {
  const list = keyed((inputs[kind]?.(graph) || []).filter(i => numeric(i.block[i.prop]) || components(i.block[i.prop]).length));
  return list.map(i => {
    const value = i.block[i.prop];
    const color = components(value).join('') === 'rgb' || components(value).join('') === 'rgba';
    return { key: i.key, label: i.label, min: i.min, max: i.max, integer: i.integer, color, components: numeric(value) ? null : components(value), block: i.block, prop: i.prop };
  });
}

export function bindGraph(animation, { id, title, graph, kind, onChange = () => {} }) {
  const live = () => (typeof graph === 'function' ? graph() : graph);
  const find = key => graphFields(live(), kind).find(f => f.key === key);
  const fields = graphFields(live(), kind);
  for (const field of fields) {
    const paths = field.components ? field.components.map(c => [field.key + '.' + c, c]) : [[field.key, null]];
    for (const [path, component] of paths)
      animation.register({
        id, path, label: field.label + (component ? ' ' + component.toUpperCase() : ''), group: title,
        available: () => !!live() && !!find(field.key),
        get: () => { const f = find(field.key); const v = f?.block[f.prop]; return component ? v?.[component] : v; },
        set: v => {
          const f = find(field.key);
          if (!f) return;
          if (component) f.block[f.prop][component] = v;
          else f.block[f.prop] = v;
          onChange(f);
        },
      });
  }
  return fields.map(field => ({
    ...field,
    id: id + '.' + field.key,
    refs: () => (field.components ? field.components.map(c => address(id, field.key + '.' + c)) : [address(id, field.key)]),
    get: () => { const f = find(field.key); return f?.block[f.prop]; },
    set: v => { const f = find(field.key); if (!f) return; f.block[f.prop] = field.components && v?.clone ? v.clone() : v; onChange(f); },
  }));
}
