// Every tracked file has a license in REUSE.toml, every license named there has its text in LICENSES/, and code
// derived from Blender is under the GPL (scripts/licenses.mjs).
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

console.log(execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/licenses.mjs', import.meta.url))], { encoding: 'utf8' }).trim());
