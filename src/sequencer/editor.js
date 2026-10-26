import { menuButton } from '../ui/menu.js';
import { iconButton } from '../ui/icon.js';
import './editor.css';

// Blender's Video Sequencer editor: view type Sequencer, Preview or Sequencer & Preview, plus the sidebar
// (N) with the active strip's properties. Contents are KubeezCut islands through the sequencer adapter; they
// mount the first time the area is visible, so KubeezCut loads only when someone opens the editor.
const viewTypes = { SEQUENCER: ['Sequencer', 'seq_sequencer'], PREVIEW: ['Preview', 'seq_preview'], SEQUENCER_PREVIEW: ['Sequencer & Preview', 'seq_splitview'] };

function whenVisible(element, run) {
  const observer = new ResizeObserver(() => { if (element.clientWidth && element.clientHeight) { observer.disconnect(); run(); } });
  observer.observe(element);
  return () => observer.disconnect();
}

export function mountSequencerEditor(section, { adapter, header, notify }) {
  const state = { viewType: 'SEQUENCER_PREVIEW', sidebar: false };
  section.classList.add('vse-area');
  section.innerHTML = '<div class="vse-main"><div class="vse-slot vse-preview"></div><div class="vse-slot vse-sequencer"></div></div><div class="vse-slot vse-sidebar"></div><div class="vse-loading">Loading Video Sequencer...</div>';
  const slots = { preview: section.querySelector('.vse-preview'), sequencer: section.querySelector('.vse-sequencer'), properties: section.querySelector('.vse-sidebar') };
  const loading = section.querySelector('.vse-loading');
  const mounted = {};
  let started = false;
  const ensure = async (kind) => {
    if (mounted[kind]) return;
    mounted[kind] = 'pending';
    try { mounted[kind] = await adapter.mount(kind, slots[kind]); }
    catch (error) { mounted[kind] = null; notify('Video Sequencer: ' + (error.message || error)); console.error(error); }
  };
  const sync = () => {
    section.dataset.view = state.viewType;
    section.classList.toggle('vse-with-sidebar', state.sidebar);
    sidebarButton.setAttribute('aria-pressed', String(state.sidebar));
    viewLabel.textContent = viewTypes[state.viewType][0];
    if (!started) return;
    const wanted = [...(state.viewType !== 'SEQUENCER' ? ['preview'] : []), ...(state.viewType !== 'PREVIEW' ? ['sequencer'] : []), ...(state.sidebar ? ['properties'] : [])];
    Promise.all(wanted.map(ensure)).then(() => { loading.hidden = true; if (!menuSlot.childElementCount) showMenus(); });
  };
  const viewMenu = menuButton('Sequencer & Preview', () => Object.entries(viewTypes).map(([id, [label, icon]]) => ({ label, icon, checked: () => state.viewType === id, run: () => { state.viewType = id; sync(); } })), { icon: 'sequence', className: 'bl-dropdown', title: 'View Type' });
  const viewLabel = viewMenu.querySelector('span:last-child');
  const sidebarButton = iconButton('menu_panel', 'Sidebar (N): strip properties', () => { state.sidebar = !state.sidebar; sync(); });
  const spacer = Object.assign(document.createElement('span'), { className: 'spacer' });
  // Blender's header menus, filled from the adapter once KubeezCut has loaded.
  const menuSlot = Object.assign(document.createElement('span'), { className: 'vse-menus' });
  header.replaceChildren(viewMenu, menuSlot, spacer, sidebarButton);
  const showMenus = async () => {
    const menus = await adapter.menus();
    menuSlot.replaceChildren(...Object.entries(menus).map(([label, items]) => menuButton(label, items)));
  };
  section.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input,textarea,select,[contenteditable="true"]')) { state.sidebar = !state.sidebar; sync(); }
  });
  const stop = whenVisible(section, () => { started = true; sync(); });
  sync();
  return {
    dispose() { stop(); for (const m of Object.values(mounted)) if (m && m !== 'pending') m.dispose(); },
  };
}

// Blender's File Browser, used here as the media pool: import footage, audio and images, then drag them into
// the Sequencer.
export function mountFileBrowser(section, { adapter, notify }) {
  section.classList.add('vse-area', 'vse-file-browser');
  section.innerHTML = '<div class="vse-slot vse-media"></div><div class="vse-loading">Loading File Browser...</div>';
  const slot = section.querySelector('.vse-media'), loading = section.querySelector('.vse-loading');
  let mounted = null;
  const stop = whenVisible(section, async () => {
    try { mounted = await adapter.mount('media', slot); loading.hidden = true; }
    catch (error) { notify('File Browser: ' + (error.message || error)); console.error(error); }
  });
  return { dispose() { stop(); mounted?.dispose(); } };
}
