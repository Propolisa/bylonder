// Shims for blenlib/utildefines.js: export a Blender name here to replace its generated port.
// INIT_MINMAX: min and max ready for minmax_v3v3_v3, in place.
export function INIT_MINMAX(min, max) {
  min.fill(1e30, 0, 3);
  max.fill(-1e30, 0, 3);
}
