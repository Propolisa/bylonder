// The gates before main: one production build, then in parallel the unit tests and (on that build) the e2e smoke
// tests and the workflows in shards, then the production check and the perf guard. Prints each gate's result and the
// output of failures. E2E_SHARDS and WORKFLOW_SHARDS (default 2) set the shards.
// --fast: for a single change, the smoke checks it needs (scripts/smoke-select.mjs, from the files changed since
// origin/main) and no workflows; --fast --list only lists those checks. A batch of several commits runs the full gates.
import { spawn, execFileSync } from 'node:child_process';
import { selectChecks } from './smoke-select.mjs';

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

// The files changed since this branch left origin/main, committed or not, and smoke.mjs's own diff.
function changes() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  const files = [...git('diff', '--name-only', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
  return { files, smokeDiff: git('diff', '-U0', base, '--', 'tests/e2e/smoke.mjs') };
}

const fast = process.argv.includes('--fast');
let smokeEnv = {};
if (fast) {
  const { files, smokeDiff } = changes();
  const { checks, reasons, full } = selectChecks(files, undefined, smokeDiff);
  console.log(`fast gates: ${files.length} changed files, ${checks.length}${full ? ' (all)' : ''} smoke checks${reasons.length ? `\n  ${reasons.join('\n  ')}` : ''}`);
  if (process.argv.includes('--list')) process.exit(console.log(checks.join('\n')) ?? 0);
  if (!full) smokeEnv = { SMOKE_CHECKS: checks.join('\n') };
}

// The production build alone first: its bundler needs most of the machine's memory.
const results = [await run('build', 'npm', ['run', 'build'])];
results.push(...await Promise.all([
  run('unit', process.execPath, ['scripts/run-tests.mjs'], { JOBS: '2' }),
  ...(results[0].code ? [] : [
    ...shards('e2e', 'tests/e2e/smoke.mjs', Number(process.env.E2E_SHARDS) || 2, smokeEnv),
    ...(fast ? [] : shards('workflows', 'tests/e2e/workflows.mjs', Number(process.env.WORKFLOW_SHARDS) || 2)),
  ]),
]));
if (!results[0].code) {
  results.push(await run('prod', process.execPath, ['tests/e2e/prod.mjs']));
  // Alone on the machine, so its frame counts compare with its baseline.
  results.push(await run('perf', process.execPath, ['tests/e2e/perf-guard.mjs']));
}
const failed = results.filter((r) => r.code);
for (const { name, output } of failed) console.log(`\n--- ${name}\n${output.split('\n').filter((l) => !l.startsWith('BJS')).slice(-60).join('\n')}`);
const perf = results.find((r) => r.name === 'perf' && !r.code);
if (perf) console.log(`\n--- perf\n${perf.output.trim()}`);
console.log(failed.length ? `${failed.length} gate(s) failed` : 'all gates passed');
process.exit(failed.length ? 1 : 0);
