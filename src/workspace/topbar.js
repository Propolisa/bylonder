import { menuButton } from '../ui/menu.js';
import { iconEl } from '../ui/icon.js';

export function mountTopbar({ dock, send }) {
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
    ]),
    menuButton('Render', [
      { label: 'Run Scene', icon: 'play', keys: 'Ctrl Enter', run: click('run') },
      { label: 'Stop Scene', icon: 'pause', run: click('stop') },
      { label: 'Auto-run', checked: () => autoRun.checked, run: () => { autoRun.checked = !autoRun.checked; autoRun.dispatchEvent(new Event('change')); } },
      '-',
      { label: 'Render Resolution…', icon: 'preferences', run: click('render-settings') },
    ]),
    menuButton('Window', () => [
      ...Object.entries(workspaces).map(([id, label]) => ({ label: label + ' Workspace', checked: () => current() === id, run: () => setWorkspace(id) })),
      '-',
      { label: 'Arrange Areas…', run: () => dock.openMenu() },
      { label: 'Reset Layout', run: () => dock.reset() },
    ]),
    menuButton('Help', [
      { label: 'Keyboard Shortcuts', icon: 'help', keys: '?', run: () => send('help') },
      '-',
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

  const hints = $('status-hints'), stats = $('scene-stats');
  return {
    sync,
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
