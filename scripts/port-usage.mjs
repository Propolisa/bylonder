// Which modules of the generated ports of Blender's C (tools/blender-port, *.gen.js and their shims) the production
// app still imports. Blender's code runs in the WASM module now; the ports are kept for tests and future use but should
// not ship. Writes tools/blender-port/build-usage.json; with --check, fails while any port module ships.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ENTRIES, reachable } from './import-graph.mjs';

const PORT_DIRS = ['src/bmesh/intern', 'src/bmesh/operators', 'src/bmesh/tools', 'src/blenlib', 'src/blenkernel', 'src/makesdna', 'src/intern'];
const generated = PORT_DIRS.flatMap((dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f))).filter((f) => f.endsWith('.gen.js'));
// A port's public module is the generated file's shim beside it (name.gen.js and name.js); a unit port is name.unit.gen.js.
const ports = [...new Set(generated.flatMap((gen) => [gen, gen.replace(/(\.unit)?\.gen\.js$/, '.js')]))].sort();

const shipped = reachable(APP_ENTRIES);
const usage = { shipped: ports.filter((p) => shipped.has(p)), unused: ports.filter((p) => !shipped.has(p)) };
writeFileSync('tools/blender-port/build-usage.json', JSON.stringify(usage, null, 1) + '\n');
console.log(`Ports: ${usage.shipped.length} modules ship in the app, ${usage.unused.length} are not in the build (tools/blender-port/build-usage.json)`);
if (process.argv.includes('--check') && usage.shipped.length) process.exit(1);
