// Texture datablocks (bpy.data.textures), as Blender's Texture ID: a name, a fake user and the settings of Blender's Tex
// by RNA identifier. Each is mirrored into Main as a Tex (texture.js), which the Properties editor's panels and the
// modifiers that sample it read; the records are what is saved and undone. Document slice "textures".
import { blenderMain } from '../../bmesh/bmesh-wasm.js';
import { mainTexture, readTexture, textureDefaults, writeTexture } from './texture.js';

const clone = (value) => structuredClone(value);
const ID_TE = 0x4554;

export function createTextures(world, { commit = () => {} } = {}) {
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const baseline = { textures: [] };
  let state = clone(baseline);
  // Main's Tex of each record, by id. A record undone away keeps its Tex, as Blender keeps data without users.
  const main = new Map();
  const blender = () => blenderMain();

  const byId = (id) => state.textures.find((t) => t.id === id) ?? null;
  const unique = (name, except) => {
    const taken = new Set(state.textures.filter((t) => t !== except).map((t) => t.name));
    if (!taken.has(name)) return name;
    const stem = name.replace(/\.\d{3}$/, '');
    for (let i = 1; ; i++) { const next = `${stem}.${String(i).padStart(3, '0')}`; if (!taken.has(next)) return next; }
  };
  // Main's Tex as the record is: made when missing, its name and settings written.
  function mirror(entry) {
    if (!main.has(entry.id)) main.set(entry.id, mainTexture(blender().bmain, entry.name, entry.values));
    const tex = main.get(entry.id);
    if (blender().name(tex) !== entry.name) blender().rename(tex, entry.name);
    writeTexture(tex, entry.values);
    return tex;
  }
  const changed = (finish = true) => {
    world.modifiers?.refresh();
    if (finish) commit();
    emit();
  };
  const users = (entry) => world.objects.reduce((n, node) => n + (node.metadata?.wbModifiers ?? []).filter((m) => m.values.texture === entry.id).length, 0)
    + (entry.fakeUser ? 1 : 0);

  return {
    all: () => state.textures,
    byId,
    users,
    // Main's Tex of a texture (0 for none).
    pointer: (id) => (byId(id) ? mirror(byId(id)) : 0),
    // texture.new: a copy of `from`, else Blender's new texture.
    create(from = null, { finish = true } = {}) {
      const entry = { id: crypto.randomUUID(), name: unique(from?.name ?? 'Texture'), fakeUser: false, values: from ? clone(from.values) : textureDefaults() };
      state.textures.push(entry);
      mirror(entry);
      changed(finish);
      return entry;
    },
    rename(entry, name) { if (name?.trim()) { entry.name = unique(name.trim(), entry); mirror(entry); changed(); } },
    toggleFakeUser(entry) { entry.fakeUser = !entry.fakeUser; changed(); },
    // A setting, as RNA sets it: the Tex's settings after it (a new type's) are the record's.
    set(entry, name, value, finish = true) {
      const tex = mirror(entry);
      writeTexture(tex, { [name]: value });
      entry.values = readTexture(tex);
      changed(finish);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    capture: () => clone(state),
    apply(input) {
      state = clone(input ?? baseline);
      state.textures.forEach(mirror);
      world.modifiers?.refresh();
      emit();
    },
    // Main's textures, for checking that Main and the records agree.
    mainTextures: () => blender().ids(ID_TE),
  };
}
