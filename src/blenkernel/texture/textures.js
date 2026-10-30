// Texture datablocks (bpy.data.textures): Main's Tex IDs, Blender's Texture, each seen through an entry ({ id, tex, name,
// fakeUser, values }) whose reads and writes are Main's: its name, fake user and the settings of its type by RNA
// identifier (texture.js). Blender's undo and file hold them; a write is evaluated and drawn (main-sync.js redraw).
import { settingsAfter, textureDefaults, readTexture, writeTexture, mainTexture } from './texture.js';

const ID_TE = 0x4554;

export function createTextures(world, { commit = () => {} } = {}) {
  const listeners = new Set(), entries = new Map();
  const emit = () => listeners.forEach((fn) => fn());
  const main = () => world.mainSync.blender;
  // One entry per Tex, so RNA's struct over it stays the same; its id is the Tex's address.
  const entryOf = (tex) => {
    if (!entries.has(tex)) {
      entries.set(tex, {
        id: String(tex), tex,
        get name() { return main().name(tex); },
        get fakeUser() { return main().fakeUser(tex); },
        get values() { return readTexture(tex); },
      });
    }
    return entries.get(tex);
  };
  const all = () => (world.mainSync ? main().ids(ID_TE).map(entryOf) : []);
  const byId = (id) => all().find((entry) => entry.id === id) ?? null;
  const changed = (entry, finish = true) => {
    if (entry) main().tag(entry.tex);
    world.mainSync.redraw();
    if (finish) commit();
    emit();
  };
  const users = (entry) => world.objects.reduce((n, node) => n + (world.modifiers?.stack(node) ?? []).filter((m) => m.values.texture === entry.id).length, 0)
    + (entry.fakeUser ? 1 : 0);

  return {
    all,
    byId,
    users,
    // texture.new: a copy of `from`, else Blender's new texture.
    create(from = null, { finish = true } = {}) {
      const entry = entryOf(mainTexture(main().bmain, from?.name ?? 'Texture', from ? from.values : textureDefaults()));
      changed(null, finish);
      return entry;
    },
    rename(entry, name) {
      if (!name?.trim()) return;
      main().rename(entry.tex, name.trim());
      changed(entry);
    },
    toggleFakeUser(entry) {
      main().setFakeUser(entry.tex, !entry.fakeUser);
      changed(entry);
    },
    // A setting, as RNA sets it: the settings after it (a new type's) are Blender's.
    set(entry, name, value, finish = true) {
      writeTexture(entry.tex, settingsAfter(entry.values, { [name]: value }));
      changed(entry, finish);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Main holds them: the document keeps none.
    capture: () => ({ textures: [] }),
    // A project saved when the document kept its textures: those Main does not hold by name are made in it.
    apply(input) {
      const held = new Set(all().map((entry) => entry.name));
      for (const { name, values } of input?.textures ?? []) if (!held.has(name)) mainTexture(main().bmain, name, values);
      emit();
    },
  };
}
