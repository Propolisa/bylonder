// docs/export-coverage.md: per example, how its File > Export > JavaScript page agrees with the app (the WebGL 2 look
// of the export parity matrix, tests/export-parity/matrix.mjs) and what its package runs live, ships baked or reports
// it cannot run, ranked by the largest gap first. The look comes from the matrix's report.json; what a package runs,
// from each example's export in Node (its IR's entities and the export's reports), one process per example.
//   usage: node scripts/export-coverage.mjs [--collect] [example ...]
//     --collect  export the examples again (else their last collected summaries are reused)
//     PARITY_SHOTS  where the matrix wrote report.json (as the matrix takes it)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MAIN = join(root, '../bylonder/.shots');
const SHOTS = process.env.PARITY_SHOTS ?? join(existsSync(MAIN) ? MAIN : join(root, '.shots'), 'parity/export');
const SUMMARIES = join(SHOTS, 'coverage');
const args = process.argv.slice(2), only = args.filter((a) => !a.startsWith('--'));
// The examples a .blend opens, as the matrix exports them.
const { exampleBlend } = await import('../tests/open-example.js');
const examples = readdirSync(join(root, 'examples')).filter((id) => exampleBlend(id) && (!only.length || only.includes(id)));

// One example's package as the export makes it in Node: its entities by type, live (an implementation ships) or baked,
// and the warnings and errors the export reports.
async function summarize(id) {
  const { openExample } = await import('../tests/open-example.js');
  const { exportModule } = await import('../src/io_scene_babylon/js-export.js');
  const { subscribeReports } = await import('../src/windowmanager/wm-reports.js');
  const { world, sync } = openExample(id);
  sync.view();
  const reports = [];
  subscribeReports(({ type, message }) => { if (/WARNING|ERROR/.test(type)) reports.push(message); });
  const files = await exportModule(world, { live: true });
  const entities = Object.values(JSON.parse(files['scene.ir.json']).entities ?? {});
  const tally = (list) => Object.entries(Object.groupBy(list, (e) => e.type)).map(([type, of]) => `${type} ${of.length}`).sort();
  return { id, live: tally(entities.filter((e) => e.implementation)), baked: tally(entities.filter((e) => !e.implementation)), reports: [...new Set(reports)] };
}

if (process.argv[2] === '--one') {
  console.log(JSON.stringify(await summarize(process.argv[3])));
  process.exit(0);
}

mkdirSync(SUMMARIES, { recursive: true });
if (args.includes('--collect')) {
  for (const id of examples) {
    try {
      const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--one', id], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
      writeFileSync(join(SUMMARIES, `${id}.json`), out.split('\n').find((l) => l.startsWith('{"id"')));
      console.log(`collected ${id}`);
    } catch (error) {
      writeFileSync(join(SUMMARIES, `${id}.json`), JSON.stringify({ id, error: String(error.message).split('\n')[0].slice(0, 200) }));
      console.log(`${id}: export failed`);
    }
  }
}

const report = JSON.parse(readFileSync(join(SHOTS, 'report.json'), 'utf8'));
// Every example the matrix looked at, with its package's summary where it has a .blend (a code-built one has none).
const rows = Object.keys(report).filter((key) => key.endsWith(' look-webgl2')).map((key) => key.split(' ')[0]).map((id) => {
  const file = join(SUMMARIES, `${id}.json`), look = report[`${id} look-webgl2`];
  const summary = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { id, codeBuilt: true };
  const gap = look.known ?? look.verdict?.[0] ?? '';
  return { id, summary, look, agree: look.metrics?.agree ?? null, mean: look.metrics?.mean ?? null, gap };
});
// Worst first: the least agreement, an unmeasured or failed look before a passing one.
const score = (r) => (r.agree ?? -1);
rows.sort((a, b) => score(a) - score(b));
const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const list = (items) => (items?.length ? items.join(', ') : 'none');
const cell = (text) => String(text).replaceAll('|', '/').replaceAll('\n', ' ');
const table = [
  '| Rank | Example | Agree | Mean | State | Live | Baked | Reported | Top gap |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r, i) => `| ${i + 1} | ${r.id} | ${pct(r.agree)} | ${r.mean?.toFixed(1) ?? 'n/a'} | ${r.look?.state ?? 'n/a'} | ${cell(r.summary.error ? 'export failed' : r.summary.codeBuilt ? 'built by code' : list(r.summary.live))} | ${cell(list(r.summary.baked))} | ${cell(list(r.summary.reports))} | ${cell(r.gap)} |`),
];
const measured = rows.filter((r) => r.agree !== null), passing = rows.filter((r) => r.look.state === 'ok' || r.look.state === 'fixed').length;
writeFileSync(join(root, 'docs/export-coverage.md'), `# Export coverage

What File > Export > JavaScript gives per example, ranked by the largest gap first: how much of the exported page's
WebGL 2 picture agrees with the app's Render Image (the export parity matrix's look), what the package runs live and
ships baked (its IR's entities), what the export reports it cannot run, and the top known gap. Written by
\`node scripts/export-coverage.mjs\` from the matrix's report and each example's export; do not edit it by hand.

${rows.length} examples: ${passing} within the look's tolerance (90% of pixels agree, mean difference at most 8 of
255), ${measured.length - passing} measured below it, ${rows.length - measured.length} whose page did not load or draw in time (ranked first).

${table.join('\n')}
`);
console.log(`docs/export-coverage.md: ${rows.length} examples, ${measured.length} measured`);
