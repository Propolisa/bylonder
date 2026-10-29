// The clipboard Blender's code reads and writes (tools/blender-port/wasm/clipboard.cc): the browser's, whose text the
// page keeps as it last knew it, since the browser reads the clipboard only asynchronously (on focus and on paste).
import { provided } from '../port/wasm.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x } = blenderModule;
const encoder = new TextEncoder(), decoder = new TextDecoder();
let bytes = new Uint8Array();

export const clipboardText = () => decoder.decode(bytes);
export const setClipboardText = (text) => { bytes = encoder.encode(text); };
const refresh = () => globalThis.navigator?.clipboard?.readText?.().then(setClipboardText, () => {});

provided.clipboard_text_length = () => bytes.length;
provided.clipboard_text_read = (pointer) => new Uint8Array(x.memory.buffer, pointer, bytes.length).set(bytes);
provided.clipboard_text_write = (pointer, length) => {
  setClipboardText(decoder.decode(new Uint8Array(x.memory.buffer, pointer, length)));
  globalThis.navigator?.clipboard?.writeText?.(clipboardText()).catch(() => {});
};
globalThis.addEventListener?.('focus', refresh);
globalThis.document?.addEventListener('paste', (e) => setClipboardText(e.clipboardData?.getData('text/plain') ?? clipboardText()), true);
