import { create } from 'fontkit';
const pending = new Map();
async function cached(url) {
  const cache = await caches.open('workbench-fonts-v1').catch(() => null);
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw Error('Font request failed: ' + response.status);
    await cache?.put(url, response.clone()).catch(() => {});
  }
  return response;
}
export async function fontFamilies() {
  const rows = await (await cached('https://api.fontsource.org/v1/fonts')).json();
  return rows.filter(row => row.type === 'google').map(row => row.family).sort();
}
export function loadFont({ family, weight, italic, text }) {
  const key = JSON.stringify([family, weight, italic, text]);
  if (!pending.has(key)) pending.set(key, (async () => {
    const query = new URLSearchParams({family: `${family}:ital,wght@${italic ? 1 : 0},${weight}`, text: text || 'Text', display: 'swap'});
    const css = await (await cached('https://fonts.googleapis.com/css2?' + query)).text();
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1]?.replace(/["']/g, '');
    if (!url) throw Error('Font/style unavailable. Choose a supported weight or disable italic.');
    const bytes = await (await cached(url)).arrayBuffer();
    const font = create(new Uint8Array(bytes));
    const previewFamily = 'wb-' + crypto.randomUUID();
    const face = new FontFace(previewFamily, bytes);
    await face.load();
    document.fonts.add(face);
    return { font, previewFamily };
  })().catch(error => { pending.delete(key); throw error; }));
  return pending.get(key);
}
