// A project's scenes, like Blender's bpy.data.scenes. The active scene's data stays in project.overrides and
// project.animation (the single-scene fields older readers know); records hold the other scenes' data.
export const DEFAULT_BUILDER = 'createScene';
const DEFAULT_ID = 'scene';
const SETTINGS_SLICES = ['render', 'scene', 'worlds'];
const clone = (value) => (value == null ? value : structuredClone(value));
const bare = ({ id, name, builder }) => ({ id, name, builder });

export function sceneList(project) {
  if (project.scenes?.length) return project.scenes;
  return [{ id: DEFAULT_ID, name: project.overrides?.scene?.name || 'Scene', builder: DEFAULT_BUILDER }];
}

export function activeSceneId(project) {
  const list = sceneList(project);
  return list.some((s) => s.id === project.scene) ? project.scene : list[0].id;
}

export const activeScene = (project) => bare(sceneList(project).find((s) => s.id === activeSceneId(project)));

export function sceneRecords(project) {
  const active = activeSceneId(project);
  return sceneList(project).map((s) => {
    const data = s.id === active ? project : s;
    return { ...bare(s), overrides: data.overrides || {}, animation: data.animation || null };
  });
}

export function setSceneData(project, id, { overrides, animation }) {
  const patch = { ...(overrides !== undefined && { overrides }), ...(animation !== undefined && { animation }) };
  if (id === activeSceneId(project)) Object.assign(project, patch);
  else project.scenes = sceneList(project).map((s) => (s.id === id ? { ...s, ...patch } : s));
}

const storeRecords = (records, activeId) => records.map((s) => (s.id === activeId ? bare(s) : s));

export function switchScene(project, id) {
  const records = sceneRecords(project);
  const target = records.find((s) => s.id === id);
  if (!target) throw Error('Scene not found');
  project.scenes = storeRecords(records, id);
  project.scene = id;
  project.overrides = target.overrides;
  project.animation = target.animation;
}

function uniqueName(list, name) {
  const names = new Set(list.map((s) => s.name));
  const base = name.replace(/\.\d{3}$/, '');
  let next = name;
  for (let i = 1; names.has(next); i++) next = `${base}.${String(i).padStart(3, '0')}`;
  return next;
}

// Blender's New Scene types. Linked Copy is not offered: separately built scenes cannot share objects.
const newSceneData = {
  NEW: () => ({ builder: null, overrides: {}, animation: null }),
  EMPTY: (source) => ({
    builder: null,
    overrides: Object.fromEntries(SETTINGS_SLICES.filter((k) => source.overrides[k] !== undefined).map((k) => [k, clone(source.overrides[k])])),
    animation: source.animation && { version: source.animation.version, action: { name: 'Action', tracks: [] }, time: clone(source.animation.time) },
  }),
  FULL_COPY: (source) => ({ builder: source.builder, overrides: clone(source.overrides), animation: clone(source.animation) }),
};

export function addScene(project, type = 'NEW') {
  if (!newSceneData[type]) throw Error('Unknown scene type: ' + type);
  const active = activeSceneId(project);
  const records = sceneRecords(project);
  const source = records.find((s) => s.id === active);
  const scene = { id: crypto.randomUUID(), name: uniqueName(records, type === 'NEW' ? 'Scene' : source.name), ...newSceneData[type](source) };
  project.scenes = [...storeRecords(records, active), scene];
  project.scene = active;
  return scene.id;
}

export function renameScene(project, id, name) {
  if (!name?.trim()) throw Error('Scene name cannot be empty');
  const list = sceneList(project);
  project.scenes = list.map((s) => (s.id === id ? { ...s, name: uniqueName(list.filter((o) => o.id !== id), name.trim()) } : s));
}

export function removeScene(project, id) {
  const list = sceneList(project);
  if (list.length < 2) throw Error('A project needs at least one scene');
  const index = list.findIndex((s) => s.id === id);
  if (index < 0) throw Error('Scene not found');
  if (id === activeSceneId(project)) switchScene(project, list[index === 0 ? 1 : index - 1].id);
  project.scenes = sceneList(project).filter((s) => s.id !== id);
}

export function storedScenes(project) {
  if (!project.scenes?.length) return {};
  const active = activeSceneId(project);
  return { scene: active, scenes: storeRecords(sceneRecords(project), active) };
}
