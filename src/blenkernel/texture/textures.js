// Texture datablocks (bpy.data.textures), as Blender's Texture ID: a name, a fake user and the settings of Blender's Tex
// by RNA identifier, saved and undone with the project (document slice "textures"). The scene sync keeps each equal
// to its Tex in Main both ways (main-sync.js); modifiers sample a Tex made from the record (texture.js).
import { settingsAfter, textureDefaults } from './texture.js';

const clone = (value) => structuredClone(value);

export function createTextures(world, { commit = () => {} } = {}) {
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const baseline = { textures: [] };
  let state = clone(baseline);

  const byId = (id) => state.textures.find((t) => t.id === id) ?? null;
  const unique = (name, except) => {
    const taken = new Set(state.textures.filter((t) => t !== except).map((t) => t.name));
    if (!taken.has(name)) return name;
    const stem = name.replace(/\.\d{3}$/, '');
    for (let i = 1; ; i++) { const next = `${stem}.${String(i).padStart(3, '0')}`; if (!taken.has(next)) return next; }
  };
  const changed = (finish = true) => {
    world.mainSync?.sceneChanged();
    if (finish) commit();
    emit();
  };
  const users = (entry) => world.objects.reduce((n, node) => n + (node.metadata?.wbModifiers ?? []).filter((m) => m.values.texture === entry.id).length, 0)
    + (entry.fakeUser ? 1 : 0);

  return {
    all: () => state.textures,
    byId,
    users,
    // texture.new: a copy of `from`, else Blender's new texture.
    create(from = null, { finish = true } = {}) {
      const entry = { id: crypto.randomUUID(), name: unique(from?.name ?? 'Texture'), fakeUser: false, values: from ? clone(from.values) : textureDefaults() };
      state.textures.push(entry);
      changed(finish);
      return entry;
    },
    rename(entry, name) { if (name?.trim()) { entry.name = unique(name.trim(), entry); changed(); } },
    toggleFakeUser(entry) { entry.fakeUser = !entry.fakeUser; changed(); },
    // A setting, as RNA sets it: the settings after it (a new type's) are Blender's.
    set(entry, name, value, finish = true) {
      entry.values = settingsAfter(entry.values, { [name]: value });
      changed(finish);
    },
    // Settings Blender's code wrote into Main's Tex (main-sync.js), taken without an undo step of their own.
    assign(entry, values) { entry.values = values; changed(false); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    capture: () => clone(state),
    apply(input) {
      state = clone(input ?? baseline);
      world.mainSync?.sceneChanged();
      emit();
    },
  };
}
