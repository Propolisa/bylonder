// The project's game code for the Game area: its modules under src/, imported from the run's files with `bylonder`
// mapped to this window's framework (runtime/world.js), and their definitions by name: the behaviours objects carry,
// the game's composition (src/game.js). A file edited while playing is published again and imported anew as a
// candidate; the definitions change only once the run took it (accept), so a version that does not parse or whose
// create throws never replaces the last good one.
import { BUILTINS } from '../../io_scene_babylon/runtime/game/run.js';

const CODE = /^src\/.+\.m?js$/;
/** Behaviours every project has. */
export { BUILTINS };

/**
 * @param {{ root: string, files: string[], publish: (path: string, content: string) => Promise<void> }} run the run's files (their
 *   paths), the URL they are served at, and what serves a file's new content there
 */
export function createGameCode({ root, files, publish }) {
  // The built-in behaviours (Character) first, which the project's own may stand beside.
  let definitions = new Map(BUILTINS.map((b) => [b.name, b])), composition = {}, version = 0;
  /** The file each behaviour is defined in, by its name. */
  const sources = new Map();
  const located = (made, path) => { if (made?.kind === 'behavior') sources.set(made.name, path); };
  /** What a module defines: its default export, a behaviour or the game. @param {string} path @param {string} [query] */
  const defined = async (path, query = '') => (await import(/* @vite-ignore */ root + path + query)).default;
  const merged = (made) => ({
    behaviors: new Map([...definitions, ...(made?.kind === 'behavior' ? [[made.name, made]] : [])]),
    game: made?.kind === 'game' ? made : composition,
  });
  return {
    /** Every module under src/ imported once: their behaviours and the game. */
    async load() {
      const paths = files.filter((path) => CODE.test(path));
      for (const [i, made] of (await Promise.all(paths.map((path) => defined(path)))).entries()) {
        ({ behaviors: definitions, game: composition } = merged(made));
        located(made, paths[i]);
      }
      return this;
    },
    get behaviors() { return [...definitions.values()]; },
    get game() { return composition; },
    /** The project file a behaviour is defined in. @param {string} name */
    sourceOf: (name) => sources.get(name),
    /**
     * An edited file's definitions with the others, as a candidate the run may take; null for a file that is not game
     * code. Throws where the module does not load (a syntax error), naming its line where the browser gives one.
     * @param {string} path @param {string | null} content
     */
    async candidate(path, content) {
      if (!CODE.test(path) || content === null) return null;
      await publish(path, content);
      const made = await defined(path, `?v=${++version}`), { behaviors, game } = merged(made);
      return { behaviors: [...behaviors.values()], game, accept: () => { [definitions, composition] = [behaviors, game]; located(made, path); } };
    },
  };
}

/** Where in a project file an error was thrown, from its stack: `{ line, column }` (1-based), or null. @param {unknown} error @param {string} path */
export function errorAt(error, path) {
  const stack = /** @type {any} */ (error)?.stack ?? '';
  const match = stack.match(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:\\?v=\\d+)?:(\\d+):(\\d+)`));
  return match ? { line: +match[1], column: +match[2] } : null;
}

/**
 * Where a behaviour is defined in its file's source: the `defineBehavior(` call whose `name` is `name`, as
 * `{ line, column }` (1-based), else the file's start.
 * @param {string} source @param {string} name
 */
export function definitionAt(source, name) {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = source.split('\n'), named = lines.findIndex((text) => new RegExp(`name\\s*:\\s*(['"\`])${quoted}\\1`).test(text));
  for (let i = named; i >= 0; i--) {
    const column = lines[i].indexOf('defineBehavior(');
    if (column >= 0) return { line: i + 1, column: column + 1 };
  }
  return { line: Math.max(named, 0) + 1, column: 1 };
}
