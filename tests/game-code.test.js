// tags: behaviors
// The Game area's game code (editors/space_game/game-code.js): src/ modules loaded by their definitions' names, an
// edited file a candidate that changes nothing until accepted, one that does not parse a thrown error with its line,
// and the line of an error thrown in a module.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameCode, definitionAt, errorAt } from '../src/editors/space_game/game-code.js';

const dir = mkdtempSync(join(tmpdir(), 'bylonder-game-code-'));
const define = new URL('../src/io_scene_babylon/runtime/game/define.js', import.meta.url).href;
const rock = (mood) => `import { defineBehavior } from '${define}';\nexport default defineBehavior({ name: 'Rock', create() { return { mood: '${mood}' }; } });\n`;
const write = (path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
write('src/behaviors/rock.js', rock('waiting'));
write('src/game.js', `export default { kind: 'game', start: 'Cafe' };\n`);
write('src/util.js', `export const helper = 1;\n`);
write('package.json', '{ "type": "module" }');
// What the Game area's run cache does: a candidate is served where the run serves its files.
const publish = async (path, content) => writeFileSync(join(dir, path), content);

const code = await createGameCode({ publish, root: pathToFileURL(dir).href + '/', files: ['index.js', 'src/behaviors/rock.js', 'src/game.js', 'src/util.js', 'content/cafe.ink'] }).load();
assert.deepEqual(code.behaviors.map((b) => b.name), ['Character', 'Rock'], 'the built-in Character, then the project code');
assert.equal(code.game.start, 'Cafe');
assert.equal(code.sourceOf('Rock'), 'src/behaviors/rock.js');

const next = await code.candidate('src/behaviors/rock.js', rock('admiring'));
assert.equal(next.behaviors.find((b) => b.name === 'Rock').create().mood, 'admiring');
assert.equal(code.behaviors.find((b) => b.name === 'Rock').create().mood, 'waiting', 'nothing changes until the run takes it');
next.accept();
assert.equal(code.behaviors.find((b) => b.name === 'Rock').create().mood, 'admiring');
assert.equal(await code.candidate('content/cafe.ink', 'x'), null, 'not game code');

await assert.rejects(code.candidate('src/behaviors/rock.js', 'export default defineBehavior({ name: \'Rock\',, });'), SyntaxError);
assert.equal(code.behaviors.find((b) => b.name === 'Rock').create().mood, 'admiring', 'a version that does not parse changes nothing');

write('src/behaviors/thrower.js', `export function boom() {\n  throw new Error('x');\n}\n`);
const { boom } = await import(pathToFileURL(join(dir, 'src/behaviors/thrower.js')).href + '?v=3');
let thrown;
try { boom(); } catch (error) { thrown = error; }
assert.deepEqual(errorAt(thrown, 'src/behaviors/thrower.js'), { line: 2, column: 9 });
assert.equal(errorAt(new Error('elsewhere'), 'src/behaviors/thrower.js'), null);
// Edit Source's place: the defineBehavior call of the named behaviour.
const source = "import { defineBehavior } from 'bylonder';\n\nexport default defineBehavior({\n  name: 'Rock',\n});\n";
assert.deepEqual(definitionAt(source, 'Rock'), { line: 3, column: 16 });
assert.deepEqual(definitionAt(source, 'Stone'), { line: 1, column: 1 });
console.log('game code: ok');
