// Blender's time module takes the browser's locale only when Intl accepts it: Chromium under LANG=C.UTF-8 (CI, containers)
// reports en-US@posix, which made loading Blender's Python throw and the app never boot.
import assert from 'node:assert/strict';

for (const [reported, used] of [['en-US@posix', 'en-US'], ['de-CH', 'de-CH']]) {
  globalThis.window = { navigator: { language: reported } };
  const time = await import(`../src/bl_py/time.js?${reported}`);
  assert.equal(time.__debugGetLanguage(), used, `${reported} gives ${used}`);
  assert.equal(time.__months.length, 12);
}
console.log('locale: an unusable browser locale falls back to en-US');
