// The app logo drawn as a monochrome icon, as Blender draws its own logo in the interface.
export const iconUrl = name => import.meta.env.BASE_URL + (name === 'bylonder' ? 'logo/bylonder-20.svg' : `icons/blender/${name.toLowerCase()}.svg`);
export function iconEl(name, className = '') {
  const el = document.createElement('span');
  el.className = 'bl-icon ' + className;
  el.style.maskImage = `url(${iconUrl(name)})`;
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
