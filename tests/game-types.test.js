// tags: behaviors
// types/blend.d.ts (editors/space_game/game-types.js): the .blend's names and the project's Ink knots as the global
// interface the framework's declarations read, so TypeScript completes `action('…')` and the rest and fails on a name
// that is not one; with none written, any string is taken.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameTypes, inkKnots, projectKnots } from '../src/editors/space_game/game-types.js';
import { tempDir } from './temp-dir.js';

assert.deepEqual(inkKnots('=== rock_reaction ===\n{~*clack*}\n-> END\n\n=== shift_over\n{served} served.\n'), ['rock_reaction', 'shift_over']);
assert.deepEqual(projectKnots({ 'content/cafe.ink': { content: '=== a ===\n' }, 'src/x.js': { content: '=== b ===' } }), ['a']);
const types = gameTypes({ actions: ['Wobble', 'Walk'], sounds: ['Grind'], collections: ['Cup'], objects: ['Rock'], scenes: ['Rock Hard Café'], knots: ['rock_reaction'] });
assert.match(types, /action: "Walk" \| "Wobble";/);
assert.match(gameTypes({}), /sound: never;/);

// The framework's declarations with the generated names, checked by TypeScript as the editor checks a project.
const runtime = fileURLToPath(new URL('../src/io_scene_babylon/runtime/', import.meta.url));
const dir = tempDir('bylonder-game-types-');
mkdirSync(join(dir, 'game'));
for (const name of ['define.d.ts', 'world.d.ts', 'names.d.ts', 'blend-host.d.ts']) copyFileSync(join(runtime, 'game', name), join(dir, 'game', name));
copyFileSync(join(runtime, 'blend-scene.d.ts'), join(dir, 'blend-scene.d.ts'));
const check = (source) => {
  writeFileSync(join(dir, 'blend.d.ts'), types);
  writeFileSync(join(dir, 'rock.ts'), `import { defineBehavior, float, action, knot, enumOf } from './game/define.js';\n${source}\n`);
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
      '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', fileURLToPath(new URL('../node_modules/@types', import.meta.url)),
      join(dir, 'game', 'names.d.ts'), join(dir, 'blend.d.ts'), join(dir, 'rock.ts')], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
    return '';
  } catch (error) {
    return error.stdout;
  }
};
const ok = check(`export default defineBehavior({ name: 'Rock', props: { patience: float(8), admire: action('Wobble'), reaction: knot('rock_reaction'), mood: enumOf(['grumpy', 'content']) },
  create({ props }) { const seconds: number = props.patience; const mood: 'grumpy' | 'content' = props.mood; return { update() { void seconds; void mood; } }; } });`);
assert.equal(ok, '', 'names the .blend and the Ink hold type-check, and props are typed');
assert.match(check(`export const a = action('Wobbel');`), /Wobbel/, 'a renamed or misspelt action fails');
assert.match(check(`export const k = knot('rock_reactoin');`), /rock_reactoin/, 'a knot that is not one fails');
console.log('game types: the .blend\'s names and Ink knots typed, wrong names flagged');
