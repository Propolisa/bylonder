export const RUNTIME_LAYOUT_KEY = 'workbench:layout:viewport:v2';
export function profile(width, height, coarse) {
  if (!coarse && width >= 900) return 'desktop';
  return width > height ? 'landscape' : 'portrait';
}
export function validateLayout(value, defaults, ids) {
  if (!value || !Array.isArray(value.order) || value.order.length > ids.length || !value.order.length || new Set(value.order).size !== value.order.length || value.order.some(id=>!ids.includes(id))) return structuredClone(defaults);
  const state = structuredClone(defaults);
  const added=ids.filter(id=>!value.order.includes(id));
  state.order = [...value.order,...added];
  state.hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(id=>ids.includes(id)))] : [];
  state.hidden.push(...added.filter(id=>defaults.hidden.includes(id)));
  if (state.hidden.length === ids.length) state.hidden = [];
  for (const key of Object.keys(state.sizes)) {
    const pair = value.sizes?.[key];
    if (Array.isArray(pair) && pair.length===2 && pair.every(n=>Number.isFinite(n)&&n>0)) state.sizes[key]=pair.map(n=>100*n/(pair[0]+pair[1]));
    if (typeof value.horizontal?.[key] === 'boolean') state.horizontal[key]=value.horizontal[key];
  }
  return state;
}
export function swapSections(state, slot, id) {
  const other = state.order.indexOf(id);
  if (other < 0) return;
  [state.order[slot], state.order[other]] = [state.order[other], state.order[slot]];
}
export function focusedSection(layout, focus) {
  if (focus && layout.order.includes(focus)) return focus;
  const visible=layout.order.filter(id=>!layout.hidden.includes(id));
  return visible.length===1?visible[0]:null;
}
