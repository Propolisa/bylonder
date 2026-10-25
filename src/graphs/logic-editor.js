import { openMenu } from '../ui/menu.js';
import { blockGroup, blockLabel } from './logic.js';

const SVG = 'http://www.w3.org/2000/svg';
const socketColor = type => ({ number: '#a1a1a1', FlowGraphInteger: '#598c5c', boolean: '#cca6d6', string: '#70b2ff', Color3: '#c7c729', Color4: '#c7c729', Matrix: '#b080b0' })[type] || (/Vector|Quaternion/.test(type) ? '#6363c7' : '#808080');
const category = name => ({ Event: 'input', Flow: 'converter', Animation: 'texture', Debug: 'layout', Data: 'output', Vector: 'vector', Math: 'converter' })[blockGroup(name)];
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text !== undefined ? { textContent: text } : {});

export function mountLogicEditor(host, logic) {
  const view = { x: 40, y: 40, zoom: 1 };
  const selection = new Set();
  const root = el('div', 'logic-editor');
  root.tabIndex = 0;
  const stage = el('div', 'logic-stage');
  const links = document.createElementNS(SVG, 'svg');
  links.classList.add('logic-links');
  const nodes = el('div', 'logic-nodes');
  stage.append(links, nodes);
  const hint = el('div', 'logic-hint', 'Shift A to add a node · drag sockets to connect · X to delete · Home to frame all');
  root.append(stage, hint);
  host.replaceChildren(root);
  const sockets = new Map();
  let pending = null, pointer = { x: 0, y: 0 };

  const toGraph = e => { const r = root.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom }; };
  const applyView = () => { stage.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`; root.style.backgroundPosition = `${view.x}px ${view.y}px`; root.style.backgroundSize = `${24 * view.zoom}px ${24 * view.zoom}px`; };
  const center = connection => {
    const dot = sockets.get(connection);
    if (!dot) return null;
    const a = dot.getBoundingClientRect(), r = stage.getBoundingClientRect();
    return { x: (a.left + a.width / 2 - r.left) / view.zoom, y: (a.top + a.height / 2 - r.top) / view.zoom };
  };
  const curve = (a, b, color, cls = '') => {
    const path = document.createElementNS(SVG, 'path');
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    path.setAttribute('d', `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`);
    path.setAttribute('stroke', color);
    path.setAttribute('class', 'logic-link ' + cls);
    return path;
  };
  const drawLinks = () => {
    links.replaceChildren();
    for (const block of logic.blocks) {
      for (const input of block.dataInputs) for (const output of input._connectedPoint || []) { const a = center(output), b = center(input); if (a && b) links.append(curve(a, b, socketColor(input.richType?.typeName))); }
      for (const output of block.signalOutputs || []) for (const input of output._connectedPoint || []) { const a = center(output), b = center(input); if (a && b) links.append(curve(a, b, '#e6e6e6', 'signal')); }
    }
    if (pending) { const a = center(pending.from); if (a) links.append(curve(pending.input ? pointer : a, pending.input ? a : pointer, '#ffffffaa', 'pending')); }
  };

  const valueField = input => {
    const type = input.richType?.typeName, value = input._defaultValue;
    if (input.isConnected()) return null;
    if (type === 'boolean') { const box = Object.assign(el('input'), { type: 'checkbox', checked: !!value }); box.onchange = () => logic.setDefault(input, box.checked); return box; }
    if (type === 'number' || type === 'FlowGraphInteger') {
      const field = Object.assign(el('input', 'logic-value'), { type: 'number', step: 'any', value: Number(value?.value ?? value ?? 0) });
      field.onchange = () => { const n = Number(field.value); if (Number.isFinite(n)) logic.setDefault(input, type === 'FlowGraphInteger' && value?.constructor ? new value.constructor(Math.round(n)) : n); };
      return field;
    }
    if (type === 'string' || type === 'any') {
      const field = Object.assign(el('input', 'logic-value'), { value: value ?? '', placeholder: type });
      field.onchange = () => logic.setDefault(input, type === 'any' && field.value.trim() !== '' && Number.isFinite(Number(field.value)) ? Number(field.value) : field.value);
      return field;
    }
    return null;
  };
  const socket = (connection, side, kind) => {
    const dot = el('span', 'logic-socket ' + kind + ' ' + side);
    if (kind === 'data') dot.style.background = socketColor(connection.richType?.typeName);
    dot.title = connection.name + (connection.richType ? ' · ' + connection.richType.typeName : '');
    sockets.set(connection, dot);
    dot.onpointerdown = e => {
      e.stopPropagation();
      if (side === 'in' && connection.isConnected()) {
        const from = connection._connectedPoint[0];
        logic.disconnect(connection);
        pending = from ? { from, input: false } : null;
      } else pending = { from: connection, input: side === 'in' };
      root.setPointerCapture(e.pointerId);
    };
    dot.dataset.side = side;
    dot.dataset.kind = kind;
    dot.connection = connection;
    return dot;
  };
  const row = (label, left, right, field, rightLabel) => {
    const line = el('div', 'logic-row');
    if (left) line.append(left);
    line.append(el('span', 'logic-label' + (right && !left ? ' right' : ''), left || !right ? label : rightLabel ?? label));
    if (field) line.append(field);
    if (left && right) line.append(el('span', 'logic-label right', rightLabel));
    if (right) line.append(right);
    return line;
  };
  const render = () => {
    sockets.clear();
    nodes.replaceChildren();
    for (const block of logic.blocks) {
      const name = block.getClassName(), at = logic.position(block);
      const node = el('div', 'logic-node' + (selection.has(block) ? ' selected' : ''));
      node.dataset.blCategory = category(name);
      node.style.left = at.x + 'px';
      node.style.top = at.y + 'px';
      const header = el('div', 'logic-header', blockLabel(name));
      header.title = name;
      node.append(header);
      const signals = Math.max(block.signalInputs?.length || 0, block.signalOutputs?.length || 0);
      for (let i = 0; i < signals; i++) {
        const input = block.signalInputs?.[i], output = block.signalOutputs?.[i];
        node.append(row(input?.name || '', input && socket(input, 'in', 'signal'), output && socket(output, 'out', 'signal'), null, output?.name));
      }
      for (const output of block.dataOutputs) node.append(row(output.name, null, socket(output, 'out', 'data')));
      for (const input of block.dataInputs) node.append(row(input.name, socket(input, 'in', 'data'), null, valueField(input)));
      header.onpointerdown = e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (!e.shiftKey && !selection.has(block)) selection.clear();
        selection.add(block);
        const start = toGraph(e), origin = [...selection].map(b => [b, { ...logic.position(b) }]);
        let moved = false;
        header.setPointerCapture(e.pointerId);
        header.onpointermove = ev => {
          const p = toGraph(ev), dx = p.x - start.x, dy = p.y - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          for (const [b, o] of origin) logic.move(b, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
        };
        header.onpointerup = () => { header.onpointermove = null; if (moved) logic.move(block, logic.position(block), true); else render(); };
      };
      nodes.append(node);
    }
    requestAnimationFrame(drawLinks);
  };
  const frameAll = () => {
    if (!logic.blocks.length) return;
    const xs = logic.blocks.map(b => logic.position(b).x), ys = logic.blocks.map(b => logic.position(b).y);
    const r = root.getBoundingClientRect(), w = Math.max(...xs) - Math.min(...xs) + 260, h = Math.max(...ys) - Math.min(...ys) + 200;
    view.zoom = Math.min(1.25, Math.max(0.3, Math.min(r.width / w, r.height / h) * 0.9));
    view.x = (r.width - w * view.zoom) / 2 - Math.min(...xs) * view.zoom;
    view.y = (r.height - h * view.zoom) / 2 - Math.min(...ys) * view.zoom;
    applyView();
    drawLinks();
  };
  const addMenu = async at => {
    const names = await logic.available();
    const grouped = {};
    for (const n of names) (grouped[blockGroup(n)] ||= []).push(n);
    openMenu(Object.entries(grouped).map(([group, list]) => ({ label: group, items: list.sort().map(n => ({ label: blockLabel(n), run: () => logic.add(n, at) })) })), { x: pointer.screenX ?? 0, y: pointer.screenY ?? 0 }, 'Add');
  };

  root.addEventListener('pointermove', e => {
    const p = toGraph(e);
    pointer = { ...p, screenX: e.clientX, screenY: e.clientY };
    if (pending) drawLinks();
  });
  root.addEventListener('pointerup', e => {
    if (!pending) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.logic-socket');
    const from = pending.from;
    pending = null;
    if (target?.connection && from && target.dataset.side !== (from.connectionType === 0 ? 'in' : 'out')) {
      const [output, input] = target.dataset.side === 'in' ? [from, target.connection] : [target.connection, from];
      if (target.dataset.kind === (('richType' in from) ? 'data' : 'signal')) logic.connect(output, input);
    }
    drawLinks();
  });
  root.addEventListener('pointerdown', e => {
    root.focus();
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      const start = { x: e.clientX - view.x, y: e.clientY - view.y };
      root.setPointerCapture(e.pointerId);
      const move = ev => { view.x = ev.clientX - start.x; view.y = ev.clientY - start.y; applyView(); };
      root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', () => root.removeEventListener('pointermove', move), { once: true });
    } else if (e.button === 0 && [root, stage, nodes].includes(e.target)) { selection.clear(); render(); }
  });
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const zoom = Math.min(2.5, Math.max(0.25, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - (mx - view.x) * zoom / view.zoom;
    view.y = my - (my - view.y) * zoom / view.zoom;
    view.zoom = zoom;
    applyView();
  }, { passive: false });
  root.addEventListener('keydown', e => {
    if (e.target.closest('input')) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 'a') { e.preventDefault(); addMenu({ x: pointer.x, y: pointer.y }); }
    else if ((k === 'x' || k === 'delete') && selection.size) { e.preventDefault(); logic.remove([...selection]); selection.clear(); }
    else if (k === 'home') { e.preventDefault(); frameAll(); }
    else if (k === 'a' && !e.shiftKey) { e.preventDefault(); logic.blocks.forEach(b => selection.add(b)); render(); }
    e.stopPropagation();
  });
  root.addEventListener('contextmenu', e => { e.preventDefault(); pointer = { ...toGraph(e), screenX: e.clientX, screenY: e.clientY }; addMenu(toGraph(e)); });

  const unsubscribe = logic.subscribe(() => { for (const b of [...selection]) if (!logic.blocks.includes(b)) selection.delete(b); render(); });
  const resize = new ResizeObserver(() => drawLinks());
  resize.observe(root);
  applyView();
  render();
  if (logic.blocks.length) requestAnimationFrame(frameAll);
  return { frameAll, addMenu: () => addMenu({ x: pointer.x, y: pointer.y }), dispose() { unsubscribe(); resize.disconnect(); } };
}
