// The project's types/blend.d.ts: the names game code refers to (`action('Wobble')`, `knot('rock_reaction')`), from the
// .blend and the project's Ink stories, as the global interface the framework's declarations read (runtime/game/
// names.d.ts). The editor's TypeScript then completes them and flags a name that is no longer one. Written again when
// a name changes; nothing in it is edited by hand.
export const TYPES_PATH = 'types/blend.d.ts';

/** The knots of an Ink story (`=== rock_reaction ===`). @param {string} source */
export const inkKnots = (source) => [...source.matchAll(/^\s*={2,}\s*([A-Za-z_][\w]*)\s*(?:=+\s*)?$/gm)].map((match) => match[1]);

const union = (names) => ([...new Set(names)].sort().map((name) => JSON.stringify(name)).join(' | ') || 'never');

/**
 * The file's text from the project's names, each list in any order.
 * @param {{ actions?: string[], sounds?: string[], collections?: string[], objects?: string[], scenes?: string[], knots?: string[] }} names
 */
export function gameTypes({ actions = [], sounds = [], collections = [], objects = [], scenes = [], knots = [] }) {
  return `// Written by Bylonder from the .blend and the project's Ink stories: the names game code refers to. Not edited by hand.
interface BylonderNames {
  action: ${union(actions)};
  sound: ${union(sounds)};
  collection: ${union(collections)};
  object: ${union(objects)};
  scene: ${union(scenes)};
  knot: ${union(knots)};
}
`;
}

/** The names Main holds (bpy.data), which the scene's window sends the workspace when they change. @param {any} data */
export const blendNames = (data) => ({
  actions: [...data.actions].map((a) => a.name),
  sounds: [...data.sounds].map((s) => s.name),
  collections: [...data.collections].map((c) => c.name),
  objects: [...data.objects].map((o) => o.name),
  scenes: [...data.scenes].map((s) => s.name),
});

/** The knots of a project's .ink files. @param {Record<string, { content: string }>} files the project's, by path */
export const projectKnots = (files) => Object.entries(files).filter(([path]) => path.endsWith('.ink')).flatMap(([, file]) => inkKnots(file.content));
