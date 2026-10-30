// Edit > Preferences: per browser, not per project.
const KEY = 'bylonder:preferences:v1';
const defaults = {
  keepScenesLoaded: true,
  // The Video Sequencer's setup on an empty edit: asked, or the remembered { video, scene, audio }.
  askSequencerSetup: true,
  sequencerSetup: null,
};

function read() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; }
}

let values = read();
const listeners = new Set();

export const preferences = {
  get: (key) => values[key],
  set(key, value) {
    values = { ...values, [key]: value };
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* private mode */ }
    listeners.forEach((fn) => fn(key, value));
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

export function openPreferences() {
  const dialog = document.createElement('dialog');
  dialog.className = 'bl-preferences';
  dialog.setAttribute('aria-label', 'Preferences');
  const row = (key, label, help) => {
    const wrap = document.createElement('label');
    wrap.className = 'bl-pref-row';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!values[key] });
    box.onchange = () => preferences.set(key, box.checked);
    wrap.append(box, Object.assign(document.createElement('span'), { textContent: label }));
    if (help) wrap.title = help;
    return wrap;
  };
  const section = (title, ...rows) => {
    const s = document.createElement('section');
    s.append(Object.assign(document.createElement('h3'), { textContent: title }), ...rows);
    return s;
  };
  const header = document.createElement('header');
  const close = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Close' });
  close.setAttribute('aria-label', 'Close');
  close.onclick = () => dialog.close();
  header.append(Object.assign(document.createElement('span'), { textContent: 'Preferences' }), close);
  dialog.append(header, section('System',
    row('keepScenesLoaded', 'Keep Scenes Loaded', 'Scenes stay loaded after switching away, so switching back is instant. Uses more memory and graphics contexts.'),
  ), section('Video Sequencer',
    row('askSequencerSetup', 'Ask to Set Up for Video Editing', 'When the Video Sequencer opens on an empty edit, offer to render video and add the scene; off uses the remembered choice.'),
  ));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
}
