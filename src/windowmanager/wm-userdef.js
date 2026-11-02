// The Preferences (Blender's U) in the module, kept per user in this browser: Blender's user directory (/user in the
// module's file system, ghost-paths.cc) holds userpref.blend, which Blender's own wm.save_userpref writes and
// wm.read_userpref reads; this keeps that directory in IndexedDB. Startup reads it as WM_init does, and leaving the page
// saves changed preferences when Auto-Save Preferences is on, as WM_exit does.
import { files } from '../port/wasm.js';
import { blenderMain } from '../bmesh/bmesh-wasm.js';
import { contextStruct } from '../python/bpy_rna.js';
import { keyconfigUpdated } from './wm-window.js';

const USER_DIR = '/user/', DB = 'bylonder-userdef', STORE = 'files';
const stored = new Map();
const listeners = new Set();

// A blocked open (a deleteDatabase or another tab's upgrade waiting) and an aborted transaction (quota, a closed db)
// reject, so startup falls back to factory settings instead of waiting; a newer version elsewhere closes this one.
const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(Error(`${DB} is blocked`));
});
const transaction = async (mode, fn) => {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), result = fn(tx.objectStore(STORE));
    const failed = () => { db.close(); reject(tx.error ?? Error(`${DB} transaction aborted`)); };
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = failed;
    tx.onabort = failed;
  });
};

export const preferences = () => contextStruct(blenderMain().C).preferences;

// Blender's user directory from the browser's storage, before Blender reads it.
export async function restorePreferences() {
  if (!globalThis.indexedDB) return;
  try {
    const keys = await transaction('readonly', (store) => store.getAllKeys());
    const values = await transaction('readonly', (store) => store.getAll());
    keys.forEach((path, i) => { files.set(path, values[i]); stored.set(path, values[i]); });
  } catch { /* Storage blocked: factory settings. */ }
}
// The input settings the page's own event handling reads (wm-event-system.js), kept from the Preferences.
let input = {};
const readInput = ({ inputs }) => {
  input = { emulate_3_button: inputs.use_mouse_emulate_3_button, emulate_3_button_modifier: inputs.mouse_emulate_3_button_modifier,
    emulate_numpad: inputs.use_emulate_numpad, drag_threshold: inputs.drag_threshold_mouse, scroll_direction: inputs.touchpad_scroll_direction,
    trackpad: inputs.use_multitouch_gestures };
};
export const inputPreferences = () => input;
// The Preferences read as WM_init reads them: the saved ones, else factory settings.
export function readPreferences() {
  blenderMain().run('wm.read_userpref');
  readInput(preferences());
}

// The user directory's changed files into the browser's storage (after Save Preferences, Blender's write).
export function storePreferences() {
  const changed = [...files].filter(([path, bytes]) => path.startsWith(USER_DIR) && stored.get(path) !== bytes);
  const removed = [...stored.keys()].filter((path) => !files.has(path));
  if (!globalThis.indexedDB || (!changed.length && !removed.length)) return;
  changed.forEach(([path, bytes]) => stored.set(path, bytes));
  removed.forEach((path) => stored.delete(path));
  transaction('readwrite', (store) => {
    changed.forEach(([path, bytes]) => store.put(bytes, path));
    removed.forEach((path) => store.delete(path));
  }).catch(() => {});
}

// What follows a change of the Preferences: the user key configuration made again (keymap edits), the change kept,
// and Bylonder's own readers of them (themes, input, drawing).
export function onPreferencesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function preferencesChanged() {
  keyconfigUpdated(blenderMain().C);
  storePreferences();
  readInput(preferences());
  listeners.forEach((fn) => fn(preferences()));
}

// As WM_exit: unsaved changes are saved when the preferences auto-save.
function autoSave() {
  const prefs = preferences();
  if (prefs.is_dirty && prefs.use_preferences_save) blenderMain().run('wm.save_userpref');
  storePreferences();
}
if (globalThis.addEventListener) addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoSave(); });
