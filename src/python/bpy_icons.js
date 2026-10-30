// bpy.app.icons over the module: a tool's geometry icon, by the file Blender reads its triangles from, is one icon of
// Blender's icon system (region-draw.cc icon_geom_new), made once per file as Blender's toolbar caches it.
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { nameToolIcon } from '../editors/interface/icon.js';

const { exports: x, withString } = blenderModule;
const icons = new Map();
export function geometryIcon(filepath) {
  const name = filepath.split('/').pop().replace(/\.dat$/, '');
  if (!icons.has(name)) {
    icons.set(name, withString(name, (p) => x.icon_geom_new(p)));
    nameToolIcon(icons.get(name), name);
  }
  return icons.get(name);
}
export function releaseIcon(value) {
  for (const [name, id] of icons) if (id === value) icons.delete(name);
  x.icon_release(value);
}
