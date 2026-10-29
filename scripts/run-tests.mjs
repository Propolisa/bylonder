// Runs the unit tests (tests/*.test.js, or those whose names contain an argument) in parallel, one process each, as
// many at a time as there are cores (JOBS=n to change it), slowest first by the last run's times. Prints each test's
// last line and time, and a failing test's whole output. Tests of generated ports the app no longer ships
// (scripts/port-usage.mjs) are skipped unless --ports is given.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { availableParallelism } from 'node:os';
import { portUsage, reachable } from './import-graph.mjs';

const TIMES = 'node_modules/.cache/test-times.json';
const read = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const times = read(TIMES);
const ports = process.argv.includes('--ports');
const filters = process.argv.slice(2).filter((a) => a !== '--ports');
const unshipped = new Set(portUsage().unused);
const testsPort = (test) => [...reachable([test])].some((m) => unshipped.has(m));
const matching = readdirSync('tests').filter((f) => f.endsWith('.test.js') && (!filters.length || filters.some((s) => f.includes(s)))).map((f) => `tests/${f}`);
const skipped = ports ? [] : matching.filter(testsPort);
const tests = matching.filter((t) => !skipped.includes(t)).sort((a, b) => (times[b] ?? Infinity) - (times[a] ?? Infinity));
if (skipped.length) console.log(`skip ${skipped.join(', ')} (ports the app does not ship; --ports runs them)`);

const run = (test) => new Promise((resolve) => {
  const start = performance.now(), child = spawn(process.execPath, [test], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('close', (code) => resolve({ test, code, output, seconds: (performance.now() - start) / 1000 }));
});

const failed = [];
let next = 0;
const worker = async () => {
  while (next < tests.length) {
    const result = await run(tests[next++]);
    times[result.test] = result.seconds;
    const last = result.output.trim().split('\n').filter((l) => !l.startsWith('BJS')).at(-1) ?? '';
    console.log(`${result.code ? 'FAIL' : 'ok  '} ${result.test} (${result.seconds.toFixed(0)} s) ${result.code ? '' : last}`);
    if (result.code) failed.push(result);
  }
};
await Promise.all(Array.from({ length: Number(process.env.JOBS) || availableParallelism() }, worker));
mkdirSync(dirname(TIMES), { recursive: true });
writeFileSync(TIMES, JSON.stringify(times, null, 1));
for (const { test, output } of failed) console.log(`\n--- ${test}\n${output}`);
console.log(`${tests.length - failed.length} of ${tests.length} passed`);
process.exit(failed.length ? 1 : 0);
