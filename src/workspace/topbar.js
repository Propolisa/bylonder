import { menuButton, openMenu } from '../editors/interface/menu.js';
import { registerOperators, kw } from '../windowmanager/wm-operators.js';
import { iconEl, iconButton } from '../editors/interface/icon.js';
import { openPreferences } from './preferences.js';
import { fullDate, timeAgo } from './relative-time.js';

export function mountTopbar({ dock, send, sceneTopbar, examples, openExample, newProject, recentProjects, openProject, openBlend }) {
  const $ = id => document.getElementById(id);
  const click = id => () => $(id).click();
  const bar = $('appbar');
  const menus = $('topbar-menus');
  const autoRun = $('auto-run');
  // Blender's default workspaces, each opening the screen the scene's window has for it (docs/blender-boundary.md,
  // Workspaces): Scripting's and Shading's, else Layout's.
  const workspaces = ['Layout', 'Modeling', 'Sculpting', 'UV Editing', 'Texture Paint', 'Shading', 'Animation', 'Rendering', 'Compositing', 'Geometry Nodes', 'Scripting']
    .map((name) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, screen: ['Scripting', 'Shading'].includes(name) ? name.toLowerCase() : 'layout' }));
  let selected = 'layout';
  const current = () => selected;
  const screen = () => workspaces.find((w) => w.id === selected).screen;
  const setWorkspace = id => {
    selected = id;
    if (dock.maximized !== 'scene') dock.maximize('scene');
    send('screen', screen());
    sync();
  };
  const recent = [];
  // File > Open: a .blend file, read by Blender's reader into a new project (Open Recent lists the projects).
  const chooseBlend = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.blend' });
    input.onchange = () => input.files[0] && openBlend(input.files[0]);
    input.click();
  };
  // Bylonder's projects, by name.
  const openProjects = () => Promise.resolve().then(recentProjects).then((projects) => openMenu(projects.map((p) => ({ label: p.name, icon: 'file_blend', run: () => openProject(p.id) })), { x: innerWidth / 2 - 100, y: 60 }, 'Open'));
  // Recent projects for Open Recent, read when the menus open: the app makes its project repository after the topbar.
  const refreshRecent = () => Promise.resolve().then(recentProjects).then((projects) => recent.splice(0, Infinity, ...projects.slice(0, 10)), () => {});
  const url = (href) => () => open(href, '_blank', 'noopener');
  const blenderDocs = 'https://docs.blender.org/';
  const URL_PRESETS = { MANUAL: blenderDocs + 'manual/en/latest/', API: blenderDocs + 'api/current/', RELEASE_NOTES: 'https://developer.blender.org/docs/release_notes/' };
  const ids = workspaces.map((w) => w.id);
  const operators = {
    'wm.read_homefile': { keys: () => 'Ctrl N', run: ({ app_template: name = '' }) => (name ? openExample(examples.find((e) => e.title === name)) : click('new-project')()) },
    'wm.open_mainfile': { keys: () => 'Ctrl O', run: ({ filepath }) => (filepath ? openProject(filepath) : chooseBlend()) },
    'bylonder.project_open': { run: openProjects },
    'wm.save_mainfile': { keys: () => 'Ctrl S', run: click('checkpoint') },
    // A .blend file of the scene, from Blender's writer in the scene window; a copy too, as the open project stays.
    'wm.save_as_mainfile': { keys: ({ copy }) => (copy ? undefined : 'Shift Ctrl S'), run: () => send('save-blend') },
    'bylonder.project_fork': { run: click('fork-project') },
    'ed.undo': { keys: () => 'Ctrl Z', run: () => send('invoke', 'ed.undo') },
    'ed.redo': { keys: () => 'Shift Ctrl Z', run: () => send('invoke', 'ed.redo') },
    'screen.userpref_show': { run: openPreferences },
    'render.render': { keys: ({ animation }) => (animation ? 'Ctrl F12' : 'F12'), run: ({ animation }) => send('render', animation ? 'animation' : 'image') },
    'render.view_show': { keys: () => 'F11', run: () => send('render', 'view') },
    'screen.workspace_cycle': { run: ({ direction }) => setWorkspace(ids[(ids.indexOf(current()) + (direction === 'PREV' ? ids.length - 1 : 1)) % ids.length]) },
    'wm.window_fullscreen_toggle': { run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) },
    'wm.splash': { run: () => splash() },
    'wm.url_open_preset': { supports: ({ type }) => type in URL_PRESETS, run: ({ type }) => url(URL_PRESETS[type])() },
    'wm.url_open': { run: ({ url: href }) => url(href)() },
    'bylonder.project_rename': { run: click('rename-project') },
    'bylonder.project_share': { run: click('share-project') },
    'bylonder.project_import': { run: click('import') },
    'bylonder.project_export': { run: click('export') },
    'bylonder.export_babylon': { run: () => send('export', 'babylon') },
    'bylonder.export_js': { run: () => send('export', 'js') },
    'bylonder.export_js_live': { run: () => send('export', 'js-live') },
    'bylonder.app_source': { run: click('app-source') },
    'bylonder.scene_edits_clear': { run: click('clear-scene-edits') },
    'bylonder.run': { keys: () => 'Ctrl Enter', run: click('run') },
    'bylonder.stop': { run: click('stop') },
    'bylonder.render_settings': { run: click('render-settings') },
    'bylonder.areas_arrange': { run: () => dock.openMenu() },
    // The project's code (Monaco, files and the browser console's output) beside the scene, as an add-on's workbench.
    'bylonder.project_code': { run: () => { if (dock.maximized === 'scene') { dock.maximize('scene'); dock.show('code'); } else dock.maximize('scene'); } },
    'bylonder.layout_reset': { run: () => dock.reset() },
    'bylonder.scene_edits_remember': { run: click('toggle-remember') },
    'bylonder.auto_run_toggle': { run: () => { autoRun.checked = !autoRun.checked; autoRun.dispatchEvent(new Event('change')); } },
    'bylonder.docs': { run: url(import.meta.env.BASE_URL + 'docs.html') },
    'bylonder.babylon_docs': { run: url('https://doc.babylonjs.com/') },
  };
  registerOperators(operators);
  // Bylonder's entries in Blender's menus, as an add-on's (Menu.append); its settings as check entries.
  const op = (layout, idname, text, icon) => layout.operator(idname, kw({ text, ...(icon && { icon }) }));
  const check = (layout, idname, text, on) => op(layout, idname, text, on ? 'CHECKBOX_HLT' : 'CHECKBOX_DEHLT');
  const extensions = [
    ['TOPBAR_MT_file', 'append', ({ layout }) => { layout.separator(); op(layout, 'bylonder.project_open', 'Open Project...'); op(layout, 'bylonder.project_fork', 'Save Project As...'); op(layout, 'bylonder.project_rename', 'Rename Project...'); op(layout, 'bylonder.project_share', 'Share Project Link...'); op(layout, 'bylonder.app_source', 'Download App Source'); }],
    // Open Recent lists Bylonder's recent projects.
    ['TOPBAR_MT_file_open_recent', 'append', ({ layout }) => { for (const project of recent) op(layout, 'wm.open_mainfile', project.name, 'FILE_BLEND').filepath = project.id; }],
    ['TOPBAR_MT_file_import', 'append', ({ layout }) => op(layout, 'bylonder.project_import', 'Project ZIP (.zip)')],
    ['TOPBAR_MT_file_export', 'append', ({ layout }) => { op(layout, 'bylonder.export_babylon', 'Babylon (.babylon)'); op(layout, 'bylonder.export_js', 'JavaScript (.js)'); op(layout, 'bylonder.export_js_live', 'JavaScript, Live Modifiers (.zip)'); op(layout, 'bylonder.project_export', 'Project ZIP (.zip)'); }],
    ['TOPBAR_MT_edit', 'append', ({ layout }) => { layout.separator(); check(layout, 'bylonder.scene_edits_remember', 'Remember Scene Edits', $('remember').checked); op(layout, 'bylonder.scene_edits_clear', 'Clear Scene Edits'); }],
    ['TOPBAR_MT_render', 'prepend', ({ layout }) => { op(layout, 'bylonder.run', 'Run'); op(layout, 'bylonder.stop', 'Stop'); check(layout, 'bylonder.auto_run_toggle', 'Auto-run', autoRun.checked); layout.separator(); }],
    ['TOPBAR_MT_render', 'append', ({ layout }) => { layout.separator(); op(layout, 'bylonder.render_settings', 'Viewport Resolution...'); }],
    ['TOPBAR_MT_window', 'append', ({ layout }) => { layout.separator(); op(layout, 'bylonder.project_code', 'Toggle Project Code'); op(layout, 'bylonder.areas_arrange', 'Arrange Areas...'); op(layout, 'bylonder.layout_reset', 'Reset Layout'); }],
    ['TOPBAR_MT_help', 'append', ({ layout }) => { layout.separator(); layout.operator('wm.splash'); layout.separator(); op(layout, 'bylonder.docs', 'Bylonder Documentation'); op(layout, 'bylonder.babylon_docs', 'Babylon.js Documentation'); }],
  ];
  // Blender's menus, laid out in the scene window, where Main is (editors/space_topbar/topbar-area.js,
  // `sceneTopbar()`): each scene window gets Bylonder's operators and entries once, and the bar its menus from the
  // first that runs (connect()).
  const hosted = new WeakSet();
  const scene = () => {
    const topbarArea = sceneTopbar();
    if (topbarArea && !hosted.has(topbarArea)) {
      hosted.add(topbarArea);
      topbarArea.host(operators, extensions, examples.map((example) => example.title));
    }
    return topbarArea;
  };
  const connect = () => {
    if (menus.childElementCount || !scene()) return;
    for (const { label, menu } of scene().bar()) {
      const logo = menu === 'TOPBAR_MT_blender';
      const items = () => { refreshRecent(); const topbarArea = scene(); return topbarArea?.items(menu) ?? []; };
      menus.append(menuButton(logo ? '' : label, items, { blender: menu, icon: logo ? 'bylonder' : undefined }));
    }
    bar.querySelector('.bl-logo')?.remove();
  };
  const tabs = $('workspace-tabs');
  for (const { id, name } of workspaces) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.workspace = id;
    b.textContent = name;
    b.onclick = () => setWorkspace(id);
    tabs.append(b);
  }
  const sync = () => tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.workspace === current()));
  new MutationObserver(sync).observe(document.querySelector('#workspace'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  sync();

  // The version and the build's commit; hovering tells when it last changed.
  function versionLabel() {
    const change = __BYLONDER_CHANGE__;
    const label = Object.assign(document.createElement('span'), { className: 'bl-splash-version', textContent: change ? `${__BYLONDER_VERSION__} (${change.hash})` : __BYLONDER_VERSION__ });
    if (change) label.title = `Last changed ${timeAgo(change.time)}, ${fullDate(change.time)}: ${change.subject}`;
    return label;
  }

  // Laid out like Blender's splash: Blender's artwork (public/splash.webp from release/datafiles/splash.png, with its logo and
  // credit) and the version, New File and Recent Files, then Open and links.
  function splash() {
    const dialog = document.createElement('dialog');
    dialog.className = 'bl-splash';
    const item = (label, icon, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.append(iconEl(icon), label);
      b.onclick = () => { dialog.close(); run(); };
      return b;
    };
    const column = (heading, items) => {
      const c = document.createElement('div');
      c.append(Object.assign(document.createElement('h3'), { textContent: heading }), ...items);
      return c;
    };
    const banner = document.createElement('div');
    banner.className = 'bl-splash-banner';
    banner.append(versionLabel());
    const recent = column('Recent Files', []);
    recentProjects().then((projects) => recent.append(...projects.slice(0, 5).map((p) => item(p.name, 'file_blend', () => openProject(p.id))), item('More…', 'viewzoom', openProjects)));
    const files = Object.assign(document.createElement('div'), { className: 'bl-splash-columns' });
    files.append(column('New File', [item('General', 'file_new', newProject), ...examples.map(example => item(example.title, 'file_new', () => openExample(example)))]), recent);
    const links = Object.assign(document.createElement('div'), { className: 'bl-splash-columns bl-splash-links' });
    links.append(
      column('', [item('Open…', 'file_folder', () => document.getElementById('import').click())]),
      column('', [item('Blender Coverage', 'blender', () => import('../coverage/open.js').then((m) => m.openCoverage())), item('Documentation', 'help', () => open(import.meta.env.BASE_URL + 'docs.html', '_blank', 'noopener')), item('Changelog', 'time', () => import('./changelog/open.js').then((m) => m.openChangelog()))]),
    );
    dialog.append(banner, files, links);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
  }
  const hints = $('status-hints'), stats = $('scene-stats'), viewLayer = $('view-layer');
  const viewLayerOp = (op) => () => send('view-layer', { op, id: viewLayer.value });
  viewLayer.onchange = viewLayerOp('set');
  const removeViewLayer = iconButton('x', 'Remove View Layer', viewLayerOp('remove'));
  $('view-layer-actions').append(iconButton('duplicate', 'Add View Layer', viewLayerOp('add')), removeViewLayer);
  return {
    sync,
    screen,
    splash,
    connect,
    status({ hints: list = [], stats: text = '', viewLayers }) {
      if (viewLayers) {
        viewLayer.replaceChildren(...viewLayers.list.map(([value, textContent]) => Object.assign(document.createElement('option'), { value, textContent })));
        viewLayer.value = viewLayers.active;
        removeViewLayer.disabled = viewLayers.list.length < 2;
      }
      hints.replaceChildren(...list.map(([icons, label]) => {
        const span = document.createElement('span');
        span.className = 'bl-hint';
        for (const name of icons) span.append(name.startsWith('mouse_') ? iconEl(name) : Object.assign(document.createElement('kbd'), { textContent: name }));
        span.append(label);
        return span;
      }));
      stats.textContent = text;
    },
  };
}
