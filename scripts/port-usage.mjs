// Which modules of the generated ports of Blender's C (tools/blender-port, *.gen.js and their shims) the production
// app still imports. Blender's code runs in the WASM module now; the ports are kept for tests and future use but should
// not ship. Writes tools/blender-port/build-usage.json; with --check, fails while any port module ships.
import { writeFileSync } from 'node:fs';
import { portUsage } from './import-graph.mjs';

const usage = portUsage();
writeFileSync('tools/blender-port/build-usage.json', JSON.stringify(usage, null, 1) + '\n');
console.log(`Ports: ${usage.shipped.length} modules ship in the app, ${usage.unused.length} are not in the build (tools/blender-port/build-usage.json)`);
if (process.argv.includes('--check') && usage.shipped.length) process.exit(1);
