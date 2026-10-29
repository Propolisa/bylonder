// The gates before main, in parallel where they do not share state: the unit tests, then (on one production build)
// the e2e smoke tests and the workflows in shards, then the production check. Prints each gate's result and the
// output of failures. E2E_SHARDS and WORKFLOW_SHARDS (default 2) set the shards.
import { spawn } from 'node:child_process';

const run = (name, command, args, env = {}) => new Promise((resolve) => {
  const start = performance.now(), child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('close', (code) => {
    console.log(`${code ? 'FAIL' : 'ok  '} ${name} (${((performance.now() - start) / 1000).toFixed(0)} s)`);
    resolve({ name, code, output });
  });
});
const shards = (name, script, n) => Array.from({ length: n }, (_, i) => run(`${name} ${i + 1}/${n}`, process.execPath, [script], { SHARD: `${i}/${n}` }));

const results = await Promise.all([
  run('unit', process.execPath, ['scripts/run-tests.mjs'], { JOBS: '2' }),
  run('build', 'npm', ['run', 'build']),
]);
if (!results[1].code) {
  results.push(...await Promise.all([
    ...shards('e2e', 'tests/e2e/smoke.mjs', Number(process.env.E2E_SHARDS) || 2),
    ...shards('workflows', 'tests/e2e/workflows.mjs', Number(process.env.WORKFLOW_SHARDS) || 2),
  ]));
  results.push(await run('prod', process.execPath, ['tests/e2e/prod.mjs']));
}
const failed = results.filter((r) => r.code);
for (const { name, output } of failed) console.log(`\n--- ${name}\n${output.split('\n').filter((l) => !l.startsWith('BJS')).slice(-60).join('\n')}`);
console.log(failed.length ? `${failed.length} gate(s) failed` : 'all gates passed');
process.exit(failed.length ? 1 : 0);
