// An editor that is Blender's own: an area of Blender's window (wm-window.js) of one space type, its header laid out by
// Blender's uiLayout (TEXT_HT_header and its menus, block-view.js) and its main region drawn by its type's draw
// (region-draw.js). Its input goes to Blender's window (wm-areas.js), which runs the editor's operators with Blender's
// keymaps; the page only gives the regions their rectangles, from the editor's elements.
import { createApp, h, reactive, markRaw, Teleport } from 'vue';
import { blenderMain, operatorNames } from '../../bmesh/bmesh-wasm.js';
import { RGN_TYPE_WINDOW, RGN_TYPE_HEADER, RGN_TYPE_FOOTER, allowOperators } from '../../windowmanager/wm-window.js';

const RGN_TYPE_UI = 4, RGN_TYPE_TOOLS = 5, RGN_TYPE_TOOL_HEADER = 12;
// The regions over the main region (region overlap) and the space's flags that show them.
const OVERLAPS = { [RGN_TYPE_TOOLS]: 'show_region_toolbar', [RGN_TYPE_UI]: 'show_region_ui', [RGN_TYPE_TOOL_HEADER]: 'show_region_tool_header' };
import { blenderWindow, registerArea } from '../../windowmanager/wm-areas.js';
import { hasOperator, inArea, invokeOperator } from '../../windowmanager/wm-operators.js';
import { keymapHandler, blenderKeys } from '../../windowmanager/keyconfig.js';
import { regionHeader, regionPanels, panelClosedSet } from '../interface/ui-tree.js';
import { BlockView, PanelsView, sidebarView } from '../interface/block-view.js';
import { createToolbar } from '../space_view3d/view3d-toolbar.js';
import { contextStruct, inPythonContext, pointerStruct, structFind } from '../../python/bpy_rna.js';
import '../space_view3d/view3d-regions.css';
import { drawRecording } from '../interface/region-draw.js';
import { SvgContext } from '../interface/svg-context.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';

const SVG = 'http://www.w3.org/2000/svg';
const pageRect = (element) => {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

//   spacetype: eSpace_Type; name: the editor's Blender identifier (TEXT_EDITOR); operators: the prefixes of Blender's
//   operators it runs (text.), but those the page registered; keymaps: the page's keymaps for what
//   Blender leaves unhandled (the page's own operators, on Main's data); header: where the header goes; finished(ops):
//   after operators finished in it; footer: whether it shows its footer region, laid out by its header type (true) or
//   drawn by its region type ('draw': the Spreadsheet's row count); context: the page's context area while its own
//   operators run (wm-operators.js); drawn(main): after its main region drew, for what Babylon draws under it (main: the
//   region's element); tools: the toolbar's panel (IMAGE_PT_tools_active), with which the area shows its toolbar, tool
//   settings and sidebar as its space's flags say; left: a panel region at its left ({ type: its eRegion_Type, units:
//   its width in widget units }, the Spreadsheet's data set).
export function mountBlenderArea(section, { spacetype, name, operators, keymaps, header: headerHost, finished = () => {}, report = () => {}, context = {}, footer = false, drawn = () => {}, tools, left = null }) {
  const area = markRaw(blenderWindow().area(spacetype));
  const prefixes = [operators].flat();
  allowOperators(blenderWindow(), operatorNames().filter((idname) => prefixes.some((prefix) => idname.startsWith(prefix)) && !hasOperator(idname)));
  const state = reactive({ revision: 0 });
  const svg = document.createElementNS(SVG, 'svg');
  // The header's and footer's elements, by region type.
  const bars = {};
  let main = null;

  const layout = () => {
    if (!main) return;
    const regions = { [RGN_TYPE_WINDOW]: pageRect(main) };
    for (const [type, element] of Object.entries(bars)) if (element?.isConnected && !element.hidden) regions[type] = pageRect(element);
    area.layout(pageRect(section), regions);
  };
  const drawMain = () => {
    layout();
    const { width, height } = main.getBoundingClientRect();
    if (!width || !height) return;
    const ctx = new SvgContext(width, height);
    drawRecording(ctx, area.draw(RGN_TYPE_WINDOW), { height });
    ctx.flush(svg);
    drawn(main);
  };
  const refresh = () => { state.revision++; toolbar?.draw(); drawMain(); };
  // A redraw at the next frame, as ED_area_tag_redraw leaves it to the window's draw, however often it is tagged.
  let tagged = 0;
  const tagRedraw = () => { tagged ||= requestAnimationFrame(() => { tagged = 0; refresh(); }); };

  // A header button's operator: the page's when it registered one, else Blender's in this area.
  const run = (idname, props = {}, event) => {
    if (hasOperator(idname)) return inArea(context, () => invokeOperator(idname, props, event));
    area.inContext(RGN_TYPE_WINDOW, () => blenderMain().invoke(idname, props, event ?? {}));
    refresh();
  };
  const ui = (type) => markRaw({
    inContext: (fn) => area.inContext(type, fn),
    refresh,
    undoPush: refresh,
    run,
    keys: (idname, props) => blenderKeys([...keymaps, 'Window'], idname, props),
    panelClosed: (id, closed) => area.inContext(type, (C) => panelClosedSet(C, id, closed)),
    report,
  });
  const barUI = Object.fromEntries([RGN_TYPE_HEADER, RGN_TYPE_FOOTER, RGN_TYPE_TOOL_HEADER, RGN_TYPE_UI, left?.type].filter((type) => type !== undefined).map((type) => [type, ui(type)]));
  const shown = (type) => !!tools && !!pointerStruct(structFind('Area'), 0, area.pointer).spaces.active[OVERLAPS[type]];
  // Blender's scripts in a region's context: fn(context).
  const python = (fn, type = RGN_TYPE_WINDOW) => area.inContext(type, (C) => inPythonContext(C, () => fn(contextStruct())));
  const toolbar = tools && createToolbar({
    panel: tools, run: (idname, props) => run(idname, props),
    python: (fn) => python(fn, RGN_TYPE_TOOLS),
    keys: (idname, props, strict) => blenderKeys([...keymaps, 'Window'], idname, props, strict),
  });
  if (toolbar) bars[RGN_TYPE_TOOLS] = toolbar.el;

  // A header or footer region as Blender lays it out (ED_region_header_layout).
  // Blender lays a region out once it has its rectangle (from its element, after the first render).
  // One ref callback per region, so a render does not detach and attach its element again.
  const refs = {};
  const regionRef = (type) => (refs[type] ??= (el) => { if (el && !bars[type]) queueMicrotask(() => state.revision++); bars[type] = el; });
  const region = (type, className, content) => h('div', { class: className, ref: regionRef(type) }, bars[type] ? content() : []);
  const headerTrees = (type) => (area.inContext(type, (C) => regionHeader(C)) ?? []).map((tree) => h(BlockView, { tree, ui: barUI[type], header: true }));
  const bar = (type) => region(type, 'bl-ui bl-area-header flex min-w-0 flex-1 items-center', () => headerTrees(type));
  // A region its type draws (region-draw.cc's recording): its background, and the blocks it lays out over it by the
  // shared renderer.
  const drawnRegion = (type) => region(type, 'bl-ui relative min-w-0 flex-1', () => {
    const { height } = bars[type].getBoundingClientRect(), recording = height ? area.draw(type) : { draw: [] };
    const background = recording.draw.find((op) => op.op === 'clear')?.color;
    return [
      background && h('div', { class: 'absolute inset-0', style: { background: `rgb(${background.slice(0, 3).map((c) => Math.round(c * 255)).join(' ')})` } }),
      ...recording.draw.filter((op) => op.op === 'layout').map(({ rect: [x0, , x1, y1], layout: trees }) => h('div', {
        class: 'absolute flex items-center', style: { left: x0 + 'px', top: height - y1 + 'px', width: x1 - x0 + 'px' },
      }, trees.map((tree) => h(BlockView, { tree, ui: barUI[type] })))),
    ];
  });
  // A region of panels (ED_region_panels).
  const panels = ({ type, units }) => h('div', { class: 'bl-area-side flex shrink-0', style: { width: `calc(var(--bl-row) * ${units})` } },
    [region(type, 'bl-ui min-w-0 flex-1 overflow-y-auto bg-region', () => [h(PanelsView, { panels: area.inContext(type, (C) => regionPanels(C)).panels, ui: barUI[type] })])]);

  const app = createApp({
    render() {
      void state.revision;
      if (toolbar) toolbar.el.hidden = !shown(RGN_TYPE_TOOLS);
      layout();
      const headerView = bar(RGN_TYPE_HEADER);
      return h('div', { class: 'bl-ui flex h-full min-h-0 flex-col', 'data-blender': name }, [
        headerHost ? h(Teleport, { to: headerHost }, [headerView]) : headerView,
        h('div', { class: 'flex min-h-0 flex-1' }, [
          left ? panels(left) : null,
          h('div', { class: 'flex min-w-0 flex-1 flex-col' }, [
            h('div', { class: ['bl-area-view relative min-h-0 flex-1 overflow-hidden', shown(RGN_TYPE_TOOL_HEADER) && 'tool-header-shown'], ref: (el) => { if (toolbar && el) el.append(toolbar.el); } }, [
              h('div', { class: 'bl-area-main absolute inset-0', ref: (el) => { if (el && el !== main) { main = el; el.append(svg); } } }),
              shown(RGN_TYPE_TOOL_HEADER) ? region(RGN_TYPE_TOOL_HEADER, 'bl-ui bl-tool-header', () => headerTrees(RGN_TYPE_TOOL_HEADER)) : null,
              shown(RGN_TYPE_UI) ? region(RGN_TYPE_UI, 'bl-ui bl-sidebar', () => sidebarView(barUI[RGN_TYPE_UI])) : null,
            ]),
            footer === 'draw' ? h('div', { class: 'bl-area-footer flex h-(--bl-header-h) shrink-0' }, [drawnRegion(RGN_TYPE_FOOTER)]) : null,
          ]),
        ]),
        footer && footer !== 'draw' ? h('div', { class: 'bl-area-footer flex h-(--bl-header-h) shrink-0 bg-header px-[calc(var(--bl-row)*.4)]' }, [bar(RGN_TYPE_FOOTER)]) : null,
      ]);
    },
  });
  app.mount(section);
  // Keys go to the area under the pointer, as Blender's do.
  section.tabIndex = -1;
  section.addEventListener('pointerenter', () => { if (!section.contains(document.activeElement)) section.focus({ preventScroll: true }); });
  // A drag in the main region keeps going to Blender off the area; the other regions' buttons take their own clicks.
  section.addEventListener('pointerdown', (e) => { if (main?.contains(e.target)) section.setPointerCapture?.(e.pointerId); });
  section.addEventListener('contextmenu', (e) => e.preventDefault());
  const resized = new ResizeObserver(() => refresh());
  resized.observe(section);
  state.revision++;

  const pageKeys = keymapHandler(keymaps), keys = (event) => inArea(context, () => pageKeys(event));
  // The regions the page lays out itself (the data set's panels, a drawn footer's blocks) take their own pointer input.
  const pageRegions = () => [left && bars[left.type], footer === 'draw' && bars[RGN_TYPE_FOOTER]].filter(Boolean);
  const unregister = registerArea({
    element: section,
    area,
    layout,
    takes: (native) => !(native instanceof MouseEvent) || !pageRegions().some((region) => region.contains(native.target)),
    redraw: (regions) => (regions.some((type) => type in bars) ? refresh() : drawMain()),
    finished: (operators) => { finished(operators); state.revision++; },
    keys,
  });
  return {
    area,
    refresh,
    tagRedraw,
    inContext: (fn) => area.inContext(RGN_TYPE_WINDOW, fn),
    python,
    dispose() { cancelAnimationFrame(tagged); unregister(); resized.disconnect(); app.unmount(); toolbar?.dispose(); area.free(); },
  };
}
