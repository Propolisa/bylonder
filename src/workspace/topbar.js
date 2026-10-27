import { menuButton } from '../editors/interface/menu.js';
import { iconEl } from '../editors/interface/icon.js';
import { openPreferences } from './preferences.js';
import { fullDate, timeAgo } from './relative-time.js';

export function mountTopbar({ dock, send, examples, openExample, newProject, recentProjects, openProject }) {
  const $ = id => document.getElementById(id);
  const click = id => () => $(id).click();
  const bar = $('appbar');
  const menus = $('topbar-menus');
  const autoRun = $('auto-run');
  const workspaces = { layout: 'Layout', scripting: 'Scripting' };
  const current = () => (dock.maximized === 'scene' ? 'layout' : dock.maximized ? null : 'scripting');
  const setWorkspace = id => {
    if (id === 'layout' ? dock.maximized !== 'scene' : dock.maximized) dock.maximize(id === 'layout' ? 'scene' : dock.maximized);
    if (id === 'scripting') dock.show('code');
    sync();
  };
  menus.append(
    menuButton('File', [
      { label: 'New Project…', blender: 'wm.read_homefile', icon: 'file_new', run: click('new-project') },
      { label: 'New from Example', blender: 'TOPBAR_MT_file_new', items: examples.map(example => ({ label: example.title, run: () => openExample(example) })) },
      { label: 'Duplicate Project…', run: click('fork-project') },
      { label: 'Rename Project…', run: click('rename-project') },
      '-',
      { label: 'Save Version', blender: 'wm.save_mainfile', icon: 'file_tick', keys: 'Ctrl S', run: click('checkpoint') },
      '-',
      { label: 'Import Project ZIP…', run: click('import') },
      { label: 'Export Project ZIP', run: click('export') },
      { label: 'Share Project Link…', run: click('share-project') },
      '-',
      { label: 'Download App Source', run: click('app-source') },
    ], { blender: 'TOPBAR_MT_file' }),
    menuButton('Edit', [
      { label: 'Undo', blender: 'ed.undo', keys: 'Ctrl Z', run: () => send('invoke', 'undo') },
      { label: 'Redo', blender: 'ed.redo', keys: 'Shift Ctrl Z', run: () => send('invoke', 'redo') },
      '-',
      { label: 'Remember Scene Edits', checked: () => $('remember').checked, run: click('toggle-remember') },
      { label: 'Clear Scene Edits', run: click('clear-scene-edits') },
      '-',
      { label: 'Preferences…', blender: 'screen.userpref_show', icon: 'preferences', run: openPreferences },
    ], { blender: 'TOPBAR_MT_edit' }),
    menuButton('Render', [
      { label: 'Run', icon: 'play', keys: 'Ctrl Enter', run: click('run'), title: 'Run the project code and rebuild the active scene' },
      { label: 'Stop', icon: 'pause', run: click('stop'), title: 'Stop the running scenes' },
      { label: 'Auto-run', checked: () => autoRun.checked, run: () => { autoRun.checked = !autoRun.checked; autoRun.dispatchEvent(new Event('change')); } },
      '-',
      { label: 'Render Image', blender: 'render.render', icon: 'render_result', keys: 'F12', run: () => send('render', 'image') },
      { label: 'Render Animation', blender: 'render.render', keys: 'Ctrl F12', run: () => send('render', 'animation') },
      { label: 'View Render', blender: 'render.view_show', keys: 'F11', run: () => send('render', 'view') },
      '-',
      { label: 'Viewport Resolution…', icon: 'preferences', run: click('render-settings') },
    ], { blender: 'TOPBAR_MT_render' }),
    menuButton('Window', () => [
      ...Object.entries(workspaces).map(([id, label]) => ({ label: label + ' Workspace', checked: () => current() === id, run: () => setWorkspace(id) })),
      '-',
      { label: 'Arrange Areas…', run: () => dock.openMenu() },
      { label: 'Reset Layout', run: () => dock.reset() },
    ], { blender: 'TOPBAR_MT_window' }),
    menuButton('Help', [
      { label: 'Splash Screen', blender: 'wm.splash', icon: 'bylonder', run: () => splash() },
      { label: 'Keyboard Shortcuts', icon: 'help', keys: '?', run: () => send('help') },
      '-',
      { label: 'Bylonder Documentation', icon: 'help', run: () => open(import.meta.env.BASE_URL + 'docs.html', '_blank', 'noopener') },
      { label: 'Babylon.js Documentation', run: () => open('https://doc.babylonjs.com/', '_blank', 'noopener') },
      { label: 'Blender Interface Manual', blender: 'wm.url_open_preset:MANUAL', run: () => open('https://docs.blender.org/manual/en/latest/interface/index.html', '_blank', 'noopener') },
    ], { blender: 'TOPBAR_MT_help' }),
  );
  const tabs = $('workspace-tabs');
  for (const [id, label] of Object.entries(workspaces)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.workspace = id;
    b.textContent = label;
    b.onclick = () => setWorkspace(id);
    tabs.append(b);
  }
  const sync = () => tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.workspace === current()));
  new MutationObserver(sync).observe(document.querySelector('#workspace'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  sync();
  bar.querySelector('.bl-logo').replaceChildren(iconEl('bylonder'));

  // The version and the build's commit; hovering tells when it last changed.
  function versionLabel() {
    const change = __BYLONDER_CHANGE__;
    const label = Object.assign(document.createElement('span'), { className: 'bl-splash-version', textContent: change ? `${__BYLONDER_VERSION__} (${change.hash})` : __BYLONDER_VERSION__ });
    if (change) label.title = `Last changed ${timeAgo(change.time)}, ${fullDate(change.time)}: ${change.subject}`;
    return label;
  }

  // Laid out like Blender's splash: artwork with logo and version, New File and Recent Files, then Open and links.
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
    const brand = Object.assign(document.createElement('div'), { className: 'bl-splash-brand' });
    brand.append(iconEl('bylonder'), Object.assign(document.createElement('strong'), { textContent: 'blember' }));
    banner.append(brand, versionLabel(), Object.assign(document.createElement('span'), { className: 'bl-splash-credit', textContent: 'Babylon.js workbench' }));
    const recent = column('Recent Files', []);
    recentProjects().then((projects) => recent.append(...projects.slice(0, 5).map((p) => item(p.name, 'file_blend', () => openProject(p.id))), item('More…', 'viewzoom', () => document.getElementById('project').focus())));
    const files = Object.assign(document.createElement('div'), { className: 'bl-splash-columns' });
    files.append(column('New File', [item('General', 'file_new', newProject), ...examples.map(example => item(example.title, 'file_new', () => openExample(example)))]), recent);
    const links = Object.assign(document.createElement('div'), { className: 'bl-splash-columns bl-splash-links' });
    links.append(
      column('', [item('Open…', 'file_folder', () => document.getElementById('import').click()), item('Keyboard Shortcuts', 'help', () => send('help'))]),
      column('', [item('Blender Coverage', 'blender', () => import('../coverage/open.js').then((m) => m.openCoverage())), item('Documentation', 'help', () => open(import.meta.env.BASE_URL + 'docs.html', '_blank', 'noopener')), item('Changelog', 'time', () => import('./changelog/open.js').then((m) => m.openChangelog()))]),
    );
    dialog.append(banner, files, links);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
  }
  const hints = $('status-hints'), stats = $('scene-stats');
  return {
    sync,
    splash,
    status({ hints: list = [], stats: text = '' }) {
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
