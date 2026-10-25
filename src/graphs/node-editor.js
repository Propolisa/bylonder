import { iconEl } from '../ui/icon.js';
import { menuButton } from '../ui/menu.js';
import './node-editor.css';
import { installEditorTheme } from './editor-theme.js';

const pick = (module, name) => module[name] || module.default?.[name] || module.default;
export const treeTypes = {
  shader: { label: 'Shader Editor', icon: 'node_material', load: async () => pick(await import('@babylonjs/node-editor'), 'NodeEditor'), options: (graph) => ({ nodeMaterial: graph }) },
  geometry: { label: 'Geometry Node Editor', icon: 'geometry_nodes', load: async () => pick(await import('@babylonjs/node-geometry-editor'), 'NodeGeometryEditor'), options: (graph, ctx) => ({ nodeGeometry: graph, hostScene: ctx.scene, hostMesh: ctx.mesh }) },
  compositor: { label: 'Compositor', icon: 'node_compositing', load: async () => pick(await import('@babylonjs/node-render-graph-editor'), 'NodeRenderGraphEditor'), options: (graph, ctx) => ({ nodeRenderGraph: graph, hostScene: ctx.scene }) },
  particles: { label: 'Particle Node Editor', icon: 'particles', load: async () => pick(await import('@babylonjs/node-particle-editor'), 'NodeParticleEditor'), options: (graph, ctx) => ({ nodeParticleSet: graph, hostScene: ctx.scene }) },
  logic: { label: 'Logic Editor', icon: 'nodetree' },
};

async function show(Editor, options) {
  const alert = window.alert;
  window.alert = () => {};
  try { Editor.Show(options); } finally { window.alert = alert; }
}

const overlapping = root => {
  const rects = [...root.querySelectorAll('[data-bl-category]')].map(n => n.getBoundingClientRect()).filter(r => r.width && r.height);
  return rects.some((a, i) => rects.slice(i + 1).some(b => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 && w * h > 0.3 * Math.min(a.width * a.height, b.width * b.height);
  }));
};

export function mountNodeEditor({ world, host, header, contexts, storageKey = 'workbench:node-editor' }) {
  let type = 'shader';
  try { type = localStorage.getItem(storageKey) || type; } catch {}
  if (!treeTypes[type]) type = 'shader';
  host.classList.add('node-editor-host');
  const untheme = installEditorTheme(host);
  const stage = Object.assign(document.createElement('div'), { className: 'node-editor-stage' });
  const empty = Object.assign(document.createElement('div'), { className: 'node-editor-empty' });
  host.append(stage, empty);
  let shown = null, token = 0, lastKey = null, current = null, mounted = null;
  const frameAll = () => (mounted?.frameAll ? mounted.frameAll() : current?.onZoomToFitRequiredObservable?.notifyObservers());

  const typeButton = menuButton('', () => Object.entries(treeTypes).map(([id, t]) => ({ label: t.label, icon: t.icon, checked: () => id === type, run: () => api.setType(id) })), { className: 'bl-dropdown', title: 'Node Tree Type' });
  const title = Object.assign(document.createElement('span'), { className: 'node-editor-title' });
  const actions = Object.assign(document.createElement('span'), { className: 'node-editor-actions' });
  const view = menuButton('View', [{ label: 'Frame All', keys: 'Home', run: frameAll }, { label: 'Reorganize Nodes', run: () => current?.onReOrganizedRequiredObservable?.notifyObservers() }]);
  host.addEventListener('keydown', e => { if (e.key === 'Home' && !e.target.closest('input,textarea,select')) { e.preventDefault(); frameAll(); } });
  header.append(typeButton, view, title, Object.assign(document.createElement('span'), { className: 'spacer' }), actions);

  const message = (text, buttons = []) => {
    empty.replaceChildren(Object.assign(document.createElement('p'), { textContent: text }), ...buttons.map(([label, run, icon]) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (icon) b.append(iconEl(icon));
      b.append(label);
      b.onclick = run;
      return b;
    }));
    empty.hidden = false;
    stage.hidden = true;
  };

  const render = async (force = false) => {
    const tree = treeTypes[type], ctx = contexts[type]?.() || {};
    const key = type + '|' + (ctx.key ?? ctx.graph?.uniqueId ?? '');
    if (!force && key === lastKey) return;
    lastKey = key;
    typeButton.replaceChildren(iconEl(tree.icon));
    title.textContent = ctx.title || tree.label;
    title.title = ctx.hint || '';
    actions.replaceChildren(...(ctx.actions || []));
    if (!ctx.graph) {
      shown = null;
      mounted?.dispose?.();
      mounted = null;
      stage.replaceChildren();
      return message(ctx.message || 'Nothing to edit here.', ctx.buttons || []);
    }
    if (shown?.graph === ctx.graph && shown.type === type) { empty.hidden = true; stage.hidden = false; return; }
    const mine = ++token;
    shown = { graph: ctx.graph, type };
    empty.hidden = true;
    stage.hidden = false;
    const container = Object.assign(document.createElement('div'), { className: 'node-editor-root' });
    mounted?.dispose?.();
    mounted = null;
    stage.replaceChildren(container);
    if (ctx.mount) { mounted = ctx.mount(container); return; }
    try {
      const Editor = await tree.load();
      if (mine !== token) return;
      await show(Editor, { ...tree.options(ctx.graph, { scene: world.scene, mesh: ctx.mesh }), hostElement: container, backgroundColor: undefined });
      current = Editor._CurrentState;
      const started = performance.now();
      let count = -1, stable = 0;
      const settle = () => {
        if (mine !== token) return;
        const now = container.querySelectorAll('[data-bl-category]').length;
        stable = now && now === count ? stable + 1 : 0;
        count = now;
        if (stable < 8 && performance.now() - started < 5000) return requestAnimationFrame(settle);
        if (overlapping(container)) current?.onReOrganizedRequiredObservable?.notifyObservers();
        setTimeout(frameAll, 80);
      };
      requestAnimationFrame(settle);
      ctx.onShow?.();
    } catch (error) {
      console.error(error);
      message('The ' + tree.label + ' could not load: ' + error.message);
    }
  };

  const api = {
    get type() { return type; },
    setType(id) {
      if (!treeTypes[id]) return;
      type = id;
      try { localStorage.setItem(storageKey, id); } catch {}
      shown = null;
      render(true);
    },
    refresh: () => render(),
    dispose() { token++; untheme(); mounted?.dispose?.(); stage.replaceChildren(); },
  };
  render();
  return api;
}
