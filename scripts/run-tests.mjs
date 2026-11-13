// Runs the unit tests (tests/*.test.js, or those whose names contain an argument) in parallel, one process each,
// slowest first by the last run's times. As many run at a time as half the cores (JOBS=n to change it) and as the
// memory free at the start holds, by each test's peak memory in its last run (scripts/test-peak.mjs). Prints each
// test's last line, time and peak memory, a failing test's whole output, and the slowest tests. Tests of generated
// ports the app no longer ships (scripts/port-usage.mjs) are skipped unless --ports is given; --fast skips those that
// begin with a line `// Full suite only: <why>` (npm run test:fast).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism, freemem, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { portUsage, reachable } from './import-graph.mjs';

const TIMES = 'node_modules/.cache/test-times.json', PEAKS = 'node_modules/.cache/test-peaks.json';
const read = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const times = read(TIMES), peaks = read(PEAKS);
const ports = process.argv.includes('--ports'), fast = process.argv.includes('--fast');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fullOnly = (test) => readFileSync(test, 'utf8').startsWith('// Full suite only:');
const unshipped = new Set(portUsage().unused);
const testsPort = (test) => [...reachable([test])].some((m) => unshipped.has(m));
const matching = readdirSync('tests').filter((f) => f.endsWith('.test.js') && (!filters.length || filters.some((s) => f.includes(s)))).map((f) => `tests/${f}`);
const skipped = [...(ports ? [] : matching.filter(testsPort)), ...(fast ? matching.filter(fullOnly) : [])];
const tests = matching.filter((t) => !skipped.includes(t)).sort((a, b) => (times[b] ?? Infinity) - (times[a] ?? Infinity));
if (skipped.length) console.log(`skip ${skipped.join(', ')} (ports the app does not ship, or full suite only)`);

// A test's peak in MB: the most its processes held at once, each counted at its own peak while it ran, or, not yet
// measured, a typical test's.
const TYPICAL_MB = 600, RESERVE_MB = 2048;
const peakOf = (test) => peaks[test] ?? TYPICAL_MB;
const preload = `--import=${pathToFileURL('scripts/test-peak.mjs')}`;
function readPeak(file) {
  try {
    const processes = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => line.split(' ').map(Number));
    rmSync(file);
    const heldAt = (time) => processes.filter(([start, end]) => start <= time && time <= end).reduce((mb, [, , peak]) => mb + peak, 0);
    return processes.length ? Math.max(...processes.map(([start]) => heldAt(start))) : undefined;
  } catch {
    return undefined;
  }
}

// A test that runs five times its last time, and at least two minutes or the limit its first line gives
// (`// Time limit: <seconds> s`), is stopped with the processes it started.
const declaredLimit = (test) => Number(/^\/\/ Time limit: (\d+) s/.exec(readFileSync(test, 'utf8'))?.[1] ?? 0);
const limitOf = (test) => Math.max(120, declaredLimit(test), 5 * (times[test] ?? 0)) * 1000;
const stop = (child) => (process.platform === 'win32' ? spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']) : child.kill('SIGKILL'));

let started = 0;
const run = (test) => new Promise((resolve) => {
  const peakFile = join(tmpdir(), `test-peak-${process.pid}-${started++}`);
  const env = { ...process.env, TEST_PEAK_FILE: peakFile, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} ${preload}`.trim() };
  const start = performance.now(), child = spawn(process.execPath, [test], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let output = '';
  const timer = setTimeout(() => { output += `\nstopped after ${limitOf(test) / 1000} s\n`; stop(child); }, limitOf(test));
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ test, code, output, seconds: (performance.now() - start) / 1000, mb: readPeak(peakFile) });
  });
});

const NOISE = /\b(error|warning|warn)\b/i;
const noise = (output) => [...Map.groupBy(output.split('\n').filter((l) => NOISE.test(l)).map((l) => l.trim().slice(0, 200)), (l) => l)].map(([line, all]) => [line, all.length]);

const failed = [];
function report(result) {
  // A failed run's time and peak may be a hang's or cut short: the last pass's stay.
  if (!result.code) times[result.test] = result.seconds;
  if (!result.code && result.mb) peaks[result.test] = result.mb;
  const last = result.output.trim().split('\n').filter((l) => !l.startsWith('BJS')).at(-1) ?? '';
  console.log(`${result.code ? 'FAIL' : 'ok  '} ${result.test} (${result.seconds.toFixed(0)} s, ${result.mb ?? '?'} MB) ${result.code ? '' : last}`);
  // What a passing test reported as an error or warning (Blender's logs, the page's console) shows too.
  if (!result.code) for (const [line, count] of noise(result.output)) console.log(`     ${count > 1 ? count + ' x ' : ''}${line}`);
  if (result.code) failed.push(result);
}

// A test starts when a job is free and its peak and those of the tests running fit in the memory free at the start,
// less a reserve; one always runs.
const jobs = Number(process.env.JOBS) || Math.max(1, availableParallelism() >> 1), budget = freemem() / 2 ** 20 - RESERVE_MB;
const running = new Map(), queue = [...tests], begun = performance.now();
const fits = (test) => !running.size || (running.size < jobs && [...running.keys()].reduce((mb, t) => mb + peakOf(t), peakOf(test)) <= budget);
while (queue.length || running.size) {
  while (queue.length && fits(queue[0])) {
    const test = queue.shift();
    running.set(test, run(test).then((result) => { running.delete(test); report(result); }));
  }
  await Promise.race(running.values());
}
mkdirSync(dirname(TIMES), { recursive: true });
writeFileSync(TIMES, JSON.stringify(times, null, 1));
writeFileSync(PEAKS, JSON.stringify(peaks, null, 1));
for (const { test, output } of failed) console.log(`\n--- ${test}\n${output}`);
const slowest = tests.filter((t) => times[t]).toSorted((a, b) => times[b] - times[a]).slice(0, 8).map((t) => `${t.slice('tests/'.length)} ${times[t].toFixed(0)} s`);
console.log(`slowest: ${slowest.join(', ')}`);
console.log(`${tests.length - failed.length} of ${tests.length} passed in ${((performance.now() - begun) / 60000).toFixed(1)} min, up to ${jobs} at a time within ${(budget / 1024).toFixed(1)} GB`);
process.exit(failed.length ? 1 : 0);
