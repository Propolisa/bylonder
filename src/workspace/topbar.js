import { menuButton } from '../editors/interface/menu.js';
import { iconEl } from '../editors/interface/icon.js';
import { openPreferences } from './preferences.js';

export function mountTopbar({ dock, send, examples, openExample, newProject }) {
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
      { label: 'New Project…', icon: 'file_new', run: click('new-project') },
      { label: 'New from Example', items: examples.map(example => ({ label: example.title, run: () => openExample(example) })) },
      { label: 'Duplicate Project…', run: click('fork-project') },
      { label: 'Rename Project…', run: click('rename-project') },
      '-',
      { label: 'Save Version', icon: 'file_tick', keys: 'Ctrl S', run: click('checkpoint') },
      '-',
      { label: 'Import Project ZIP…', run: click('import') },
      { label: 'Export Project ZIP', run: click('export') },
      { label: 'Share Project Link…', run: click('share-project') },
      '-',
      { label: 'Download App Source', run: click('app-source') },
    ]),
    menuButton('Edit', [
      { label: 'Undo', keys: 'Ctrl Z', run: () => send('invoke', 'undo') },
      { label: 'Redo', keys: 'Shift Ctrl Z', run: () => send('invoke', 'redo') },
      '-',
      { label: 'Remember Scene Edits', checked: () => $('remember').checked, run: click('toggle-remember') },
      { label: 'Clear Scene Edits', run: click('clear-scene-edits') },
      '-',
      { label: 'Preferences…', icon: 'preferences', run: openPreferences },
    ]),
    menuButton('Render', [
      { label: 'Run', icon: 'play', keys: 'Ctrl Enter', run: click('run'), title: 'Run the project code and rebuild the active scene' },
      { label: 'Stop', icon: 'pause', run: click('stop'), title: 'Stop the running scenes' },
      { label: 'Auto-run', checked: () => autoRun.checked, run: () => { autoRun.checked = !autoRun.checked; autoRun.dispatchEvent(new Event('change')); } },
      '-',
      { label: 'Render Image', icon: 'render_result', keys: 'F12', run: () => send('render', 'image') },
      { label: 'Render Animation', keys: 'Ctrl F12', run: () => send('render', 'animation') },
      { label: 'View Render', keys: 'F11', run: () => send('render', 'view') },
      '-',
      { label: 'Viewport Resolution…', icon: 'preferences', run: click('render-settings') },
    ]),
    menuButton('Window', () => [
      ...Object.entries(workspaces).map(([id, label]) => ({ label: label + ' Workspace', checked: () => current() === id, run: () => setWorkspace(id) })),
      '-',
      { label: 'Arrange Areas…', run: () => dock.openMenu() },
      { label: 'Reset Layout', run: () => dock.reset() },
    ]),
    menuButton('Help', [
      { label: 'Splash Screen', icon: 'blender', run: () => splash() },
      { label: 'Keyboard Shortcuts', icon: 'help', keys: '?', run: () => send('help') },
      '-',
      { label: 'Bylonder Documentation', icon: 'help', run: () => open(import.meta.env.BASE_URL + 'docs.html', '_blank', 'noopener') },
      { label: 'Babylon.js Documentation', run: () => open('https://doc.babylonjs.com/', '_blank', 'noopener') },
      { label: 'Blender Interface Manual', run: () => open('https://docs.blender.org/manual/en/latest/interface/index.html', '_blank', 'noopener') },
    ]),
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
  bar.querySelector('.bl-logo').replaceChildren(iconEl('blender'));

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
    banner.append(iconEl('blender'), Object.assign(document.createElement('strong'), { textContent: 'Bylonder' }), Object.assign(document.createElement('span'), { textContent: 'Babylon.js workbench' }));
    const body = document.createElement('div');
    body.className = 'bl-splash-body';
    body.append(
      column('New File', [item('General', 'file_new', newProject), ...examples.map(example => item(example.title, 'file_new', () => openExample(example)))]),
      column('Learn', [item('Babylon.js Documentation', 'help', () => open('https://doc.babylonjs.com/', '_blank', 'noopener')), item('Keyboard Shortcuts', 'help', () => send('help')), item('Continue', 'play', () => {})]),
    );
    dialog.append(banner, body);
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
