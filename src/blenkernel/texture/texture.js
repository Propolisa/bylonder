// Blender's Texture ID (Tex) in the module: a texture's settings by RNA identifier, written to and read from the DNA
// fields its RNA structs name (dna-textures.json: Texture, and CloudsTexture and the other types, all one Tex). This is
// the one mapping between Bylonder's texture records (textures.js) and Blender's Tex, in Main and in a module of its own.
import structs from '../../makesrna/dna-textures.json' with { type: 'json' };
import { dnaGet, dnaSet } from '../../makesrna/dna-struct.js';
import { blenderModule } from '../../bmesh/bmesh-wasm.js';

const { exports: x, withArrays, withString } = blenderModule;

// A type's RNA struct, as rna_Texture_refine gives it (CLOUDS is CloudsTexture, NONE is Texture).
export const textureStruct = (type) => (type === 'NONE' ? 'Texture' : type.toLowerCase().replace(/(?:^|_)(\w)/g, (_, c) => c.toUpperCase()) + 'Texture');
export const TEXTURE_TYPES = structs.Texture.properties.type.items.map(([, id]) => id);

// A type's settings, Texture's then its own, each with the RNA struct that names it: several types name one DNA field
// each their own way (cloud_type and wood_type are both stype), so a Tex's settings are those of its type. Images and
// pointers are left out (Bylonder has no Image IDs).
const scalar = ([, p]) => p.kind === 'int' || p.kind === 'float';
const settingsOf = (type) => new Map(['Texture', type === 'IMAGE' ? null : textureStruct(type)].filter((s) => structs[s])
  .flatMap((struct) => Object.entries(structs[struct].properties).filter(scalar).map(([name]) => [name, struct])));
export const textureSettings = (type) => [...settingsOf(type).keys()];

// The settings of a Tex's type, and a Tex given settings: its type first, then that type's settings it is given.
export const readTexture = (tex) => Object.fromEntries([...settingsOf(dnaGet('Texture', tex, 'type'))].map(([name, struct]) => [name, dnaGet(struct, tex, name)]));
export function writeTexture(tex, values) {
  if (values.type) dnaSet('Texture', tex, 'type', values.type);
  for (const [name, struct] of settingsOf(dnaGet('Texture', tex, 'type'))) if (name in values && name !== 'type') dnaSet(struct, tex, name, values[name]);
}

// Blender's new texture's settings (texture_init_data: the DNA defaults).
let defaults;
export function textureDefaults() {
  if (!defaults) {
    const tex = x.texture_new() >>> 0;
    defaults = readTexture(tex);
    x.texture_free(tex);
  }
  return { ...defaults };
}

// A texture in Main (BKE_texture_add) with these settings.
export function mainTexture(bmain, name, values) {
  const tex = withString(name, (p) => x.texture_add(bmain, p)) >>> 0;
  writeTexture(tex, values);
  return tex;
}

// Textures outside Main for modifiers in this module, by their settings, kept while a modifier uses one.
const outside = new Map();
export function moduleTexture(values) {
  const key = JSON.stringify(values);
  if (!outside.has(key)) {
    const tex = x.texture_new() >>> 0;
    writeTexture(tex, values);
    outside.set(key, tex);
  }
  return outside.get(key);
}
export function freeUnusedTextures() {
  for (const [key, tex] of outside) if (!x.texture_users(tex)) { x.texture_free(tex); outside.delete(key); }
}

// The texture at a point as a modifier samples it (BKE_texture_get_value): intensity, then RGBA.
export const textureValue = (tex, co) => withArrays([Float32Array.from(co), new Float32Array(5)], ([p, r]) => {
  x.texture_value(tex, p, r);
  return Array.from(new Float32Array(x.memory.buffer, r, 5));
});
