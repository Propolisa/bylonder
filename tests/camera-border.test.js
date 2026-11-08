// Camera view's border as Blender draws it (view3d_draw.cc drawviewborder): a solid line in the viewport's back color
// where the passepartout is shown, and over it the dashed guide in the view overlay color, with the overlays only.
// Bylonder had the two colors swapped, so the border read as a solid black line.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/editors/space_view3d/viewport.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.:]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';
const token = (name) => theme.match(new RegExp(`${name}:([^;]+);`))?.[1];

assert.match(rule('.camera-border'), /border:1px solid transparent/, 'no outline of its own');
assert.match(rule('.camera-border.passepartout'), /border-color:var\(--bl-viewport\)/, 'with the passepartout, a solid line in the back color (TH_BACK)');
assert.match(rule('.camera-border.guides::after'), /--dash:var\(--bl-camera-border\) 0 3px,transparent 3px 6px/, 'the dashed guide with the overlays, 3 pixels on and 3 off');
assert.equal(token('--bl-camera-border'), '#000', 'in the view overlay color (TH_VIEW_OVERLAY)');

const view3d = readFileSync(new URL('../src/editors/space_view3d/view3d.js', import.meta.url), 'utf8');
assert.match(view3d, /cameraBorder\.hidden = !frame;/, 'the border and passepartout show with the overlays off');
assert.match(view3d, /classList\.toggle\('guides', !!state\.overlays\)/, 'the dashes go with the overlays');
console.log('Camera border: a solid back-color line under the passepartout, dashed in the overlay color with the overlays');
