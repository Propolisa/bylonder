// An editor that is Blender's own: an area of Blender's window (wm-window.js) of one space type, its header laid out by
// Blender's uiLayout (TEXT_HT_header and its menus, block-view.js) and its main region drawn by its type's draw
// (region-draw.js). Its input goes to Blender's window (wm-areas.js), which runs the editor's operators with Blender's
// keymaps; the page only gives the regions their rectangles, from the editor's elements.
import { createApp, h, reactive, markRaw, Teleport } from 'vue';
import { blenderMain, operatorNames } from '../../bmesh/bmesh-wasm.js';
import { RGN_TYPE_WINDOW, RGN_TYPE_HEADER, allowOperators } from '../../windowmanager/wm-window.js';
import { blenderWindow, registerArea } from '../../windowmanager/wm-areas.js';
import { hasOperator, inArea, invokeOperator } from '../../windowmanager/wm-operators.js';
import { keymapHandler, blenderKeys } from '../../windowmanager/keyconfig.js';
import { regionHeader } from '../interface/ui-tree.js';
import { BlockView } from '../interface/block-view.js';
import { drawRecording } from '../interface/region-draw.js';
import { SvgContext } from '../interface/svg-context.js';
import '../interface/components/tailwind.css';

const SVG = 'http://www.w3.org/2000/svg';
const pageRect = (element) => {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

//   spacetype: eSpace_Type; name: the editor's Blender identifier (TEXT_EDITOR); operators: the prefix of Blender's
//   operators it runs (text.), but those the page registered; keymaps: the page's keymaps for what
//   Blender leaves unhandled (the page's own operators, on Main's data); header: where the header goes; finished(ops):
//   after operators finished in it; context: the page's context area while its own operators run (wm-operators.js).
export function mountBlenderArea(section, { spacetype, name, operators, keymaps, header: headerHost, finished = () => {}, report = () => {}, context = {} }) {
  const area = markRaw(blenderWindow().area(spacetype));
  allowOperators(blenderWindow(), operatorNames().filter((idname) => idname.startsWith(operators) && !hasOperator(idname)));
  const state = reactive({ revision: 0 });
  const svg = document.createElementNS(SVG, 'svg');
  let headerElement = null, main = null;

  const layout = () => {
    if (!main) return;
    const regions = { [RGN_TYPE_WINDOW]: pageRect(main) };
    if (headerElement) regions[RGN_TYPE_HEADER] = pageRect(headerElement);
    area.layout(pageRect(section), regions);
  };
  const drawMain = () => {
    layout();
    const { width, height } = main.getBoundingClientRect();
    if (!width || !height) return;
    const ctx = new SvgContext(width, height);
    drawRecording(ctx, area.draw(RGN_TYPE_WINDOW), { height });
    ctx.flush(svg);
  };
  const refresh = () => { state.revision++; drawMain(); };

  // A header button's operator: the page's when it registered one, else Blender's in this area.
  const run = (idname, props = {}, event) => {
    if (hasOperator(idname)) return inArea(context, () => invokeOperator(idname, props, event));
    area.inContext(RGN_TYPE_WINDOW, () => blenderMain().invoke(idname, props, event ?? {}));
    refresh();
  };
  const ui = markRaw({
    inContext: (fn) => area.inContext(RGN_TYPE_HEADER, fn),
    refresh,
    undoPush: refresh,
    run,
    keys: (idname, props) => blenderKeys([...keymaps, 'Window'], idname, props),
    report,
  });

  const app = createApp({
    render() {
      void state.revision;
      layout();
      const trees = headerElement ? area.inContext(RGN_TYPE_HEADER, (C) => regionHeader(C)) ?? [] : [];
      const headerView = h('div', { class: 'bl-ui bl-area-header flex min-w-0 flex-1 items-center', ref: (el) => { headerElement = el; } },
        trees.map((tree) => h(BlockView, { tree, ui })));
      return h('div', { class: 'bl-ui flex h-full min-h-0 flex-col', 'data-blender': name }, [
        headerHost ? h(Teleport, { to: headerHost }, [headerView]) : headerView,
        h('div', { class: 'bl-area-main min-h-0 flex-1 overflow-hidden', ref: (el) => { if (el && el !== main) { main = el; el.append(svg); } } }),
      ]);
    },
  });
  app.mount(section);
  // Keys go to the area under the pointer, as Blender's do.
  section.tabIndex = -1;
  section.addEventListener('pointerenter', () => { if (!section.contains(document.activeElement)) section.focus({ preventScroll: true }); });
  section.addEventListener('pointerdown', (e) => section.setPointerCapture?.(e.pointerId));
  section.addEventListener('contextmenu', (e) => e.preventDefault());
  const resized = new ResizeObserver(() => refresh());
  resized.observe(section);
  state.revision++;

  const pageKeys = keymapHandler(keymaps), keys = (event) => inArea(context, () => pageKeys(event));
  const unregister = registerArea({
    element: section,
    area,
    layout,
    redraw: (regions) => (regions.includes(RGN_TYPE_HEADER) ? refresh() : drawMain()),
    finished: (operators) => { finished(operators); state.revision++; },
    keys,
  });
  return {
    area,
    refresh,
    inContext: (fn) => area.inContext(RGN_TYPE_WINDOW, fn),
    dispose() { unregister(); resized.disconnect(); app.unmount(); area.free(); },
  };
}
