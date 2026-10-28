import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean);
const files = {};
for (const file of new Set(paths)) {
  // Local agent state (.claude, with nested worktrees git lists as directories) is not app source.
  if (file.startsWith('.claude/') || !(await stat(file)).isFile() || file.startsWith('.openai/') || file.startsWith('.git/') || /(^|\/)\.env(?:\.|$)/.test(file) || file === 'public/app-source.zip') continue;
  files['babylon-workbench/' + file] = new Uint8Array(await readFile(file));
}
files['babylon-workbench/SOURCE.txt'] = strToU8('Complete application source for this build.\nRun npm ci, then npm run dev. Production: npm run build.\nDependencies are pinned in package-lock.json; node_modules and deployment credentials are excluded.\nUser OPFS projects are exported separately with Export ZIP.\n');
await writeFile('public/app-source.zip', zipSync(files, { level: 6 }));
console.log('Application source ZIP: ' + Object.keys(files).length + ' files');
