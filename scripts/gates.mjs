// The gates before main: one production build, then in parallel the unit tests and (on that build) the e2e smoke
// tests and the workflows in shards, then the production check and the perf guard. Prints each gate's result and the
// output of failures. E2E_SHARDS and WORKFLOW_SHARDS (default 2) set the shards.
// By default only what the files changed since origin/main can reach runs: the unit tests whose imports reach a changed
// file or that name it, the smoke checks of its areas (scripts/smoke-select.mjs), the workflows when every smoke check
// is needed, the perf guard when drawing, rendering or evaluation changed, the export parity matrix
// (tests/export-parity/matrix.mjs) on the examples the changes reach: its Node checks beside the unit tests, its browser
// checks on the build after the production check. When every unit test is needed, the fast tier runs (npm run
// test:fast); --full runs everything; --list only lists.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { selectChecks } from './smoke-select.mjs';
import { selectUnits } from './unit-select.mjs';

const run = (name, command, args, env = {}) => new Promise((resolve) => {
  const start = performance.now(), child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && command === 'npm' });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('close', (code) => {
    console.log(`${code ? 'FAIL' : 'ok  '} ${name} (${((performance.now() - start) / 1000).toFixed(0)} s)`);
    resolve({ name, code, output });
  });
});
const shards = (name, script, n, env = {}) => Array.from({ length: n }, (_, i) => run(`${name} ${i + 1}/${n}`, process.execPath, [script], { ...env, SHARD: `${i}/${n}` }));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
// The files changed since this branch left origin/main, committed or not, and smoke.mjs's own diff. package.json and
// the lockfile count only when a package the app ships changed: dev tools (the dev gallery's viewer) reach no test.
function changes() {
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  const files = [...git('diff', '--name-only', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
  const shipped = (lock) => JSON.stringify(Object.entries(JSON.parse(lock).packages).filter(([, p]) => !p.dev));
  const appPackages = files.includes('package-lock.json') && shipped(git('show', `${base}:package-lock.json`)) !== shipped(readFileSync('package-lock.json', 'utf8'));
  return { files: files.filter((f) => appPackages || !/^package(-lock)?\.json$/.test(f)), smokeDiff: git('diff', '-U0', base, '--', 'tests/e2e/smoke.mjs') };
}

// Changes that can move frame counts or idle times.
const PERF = /^(src\/(draw|render|runtime|runtimes|blenkernel|nodes|compositor|bmesh|modifiers|editors\/space_view3d)\/|src\/main\.js$|tools\/(blender-port|blender-nodes)\/|package-lock\.json$)/;

const full = process.argv.includes('--full');
const parity = (part) => run(`export parity ${part}`, process.execPath, ['tests/export-parity/matrix.mjs', `--${part}`, ...(full ? [] : ['--changed']), ...(part === 'look' ? ['--prod'] : [])]);
const { files, smokeDiff } = changes();
const selection = full ? { checks: [], reasons: [], full: true } : selectChecks(files, undefined, smokeDiff);
const units = full ? null : selectUnits(files);
const perf = full || files.some((f) => PERF.test(f));
console.log(full ? 'full gates' : `${files.length} changed files: ${units ? units.length : 'all'} unit tests, ${selection.full ? 'all smoke checks and the workflows' : `${selection.checks.length} smoke checks`}${perf ? ', the perf guard' : ''}${selection.reasons.length ? `\n  ${selection.reasons.join('\n  ')}` : ''}`);
if (process.argv.includes('--list')) process.exit(console.log([...(units ?? ['(all unit tests)']), ...selection.checks].join('\n')) ?? 0);
const smokeEnv = selection.full ? {} : { SMOKE_CHECKS: selection.checks.join('\n') };

// The production build alone first: its bundler needs most of the machine's memory.
const results = [await run('build', 'npm', ['run', 'build'])];
results.push(...await Promise.all([
  ...(units?.length === 0 ? [] : [run('unit', process.execPath, ['scripts/run-tests.mjs', ...(units?.map((t) => t.slice('tests/'.length)) ?? (full ? [] : ['--fast']))], { JOBS: '2' })]),
  parity('node'),
  ...(results[0].code ? [] : [
    ...shards('e2e', 'tests/e2e/smoke.mjs', Number(process.env.E2E_SHARDS) || 2, smokeEnv),
    ...(selection.full ? shards('workflows', 'tests/e2e/workflows.mjs', Number(process.env.WORKFLOW_SHARDS) || 2) : []),
  ]),
]));
if (!results[0].code) {
  results.push(await run('prod', process.execPath, ['tests/e2e/prod.mjs']));
  results.push(await parity('look'));
  // Alone on the machine, so its frame counts compare with its baseline.
  if (perf) results.push(await run('perf', process.execPath, ['tests/e2e/perf-guard.mjs']));
}
const failed = results.filter((r) => r.code);
for (const { name, output } of failed) console.log(`\n--- ${name}\n${output.split('\n').filter((l) => !l.startsWith('BJS')).slice(-60).join('\n')}`);
const guard = results.find((r) => r.name === 'perf' && !r.code);
if (guard) console.log(`\n--- perf\n${guard.output.trim()}`);
console.log(failed.length ? `${failed.length} gate(s) failed` : 'all gates passed');
process.exit(failed.length ? 1 : 0);
