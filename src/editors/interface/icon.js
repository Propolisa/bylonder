import sizes from './icon-sizes.json' with { type: 'json' };

// Every icon ships in one module (scripts/blender-icons.mjs), loaded before the interface first draws, so none is
// fetched or pops in when first shown.
let icons = {};
export const preloadIcons = () => import('virtual:blender-icons').then((m) => { icons = m.default; });
const urls = new Map();
const dataUrl = (key) => icons[key] && (urls.get(key) ?? urls.set(key, 'data:image/svg+xml,' + encodeURIComponent(icons[key])).get(key));
export const iconSvg = (name) => icons[name.toLowerCase()] ?? '';
// The app logo drawn as a monochrome icon, as Blender draws its own logo in the interface.
export const iconUrl = name => (name === 'bylonder' ? import.meta.env.BASE_URL + 'logo/bylonder-20.svg' : dataUrl(name.toLowerCase()) ?? '');
// An icon's mask at Blender's scale: 1600 units of its document at the icon's size, centered (blf_glyph_cache_add_svg).
export function iconStyle(name) {
  const [width, height] = sizes[name.toLowerCase()] ?? [1600, 1600];
  return { maskImage: `url("${iconUrl(name)}")`, maskSize: `${width / 16}% ${height / 16}%` };
}
// A tool's icon (tools/blender-ui/icons.py), by the name bpy.app.icons gives it.
export const toolIconUrl = (name) => dataUrl(`tools/${name}`) ?? '';
export function iconEl(name, className = '') {
  const el = document.createElement('span');
  el.className = 'bl-icon ' + className;
  Object.assign(el.style, iconStyle(name));
  el.setAttribute('aria-hidden', 'true');
  return el;
}
export function iconButton(name, title, onclick, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bl-icon-button ' + className;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(iconEl(name));
  b.onclick = onclick;
  return b;
}
