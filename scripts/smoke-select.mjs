// The smoke checks a change needs (node scripts/gates.mjs --fast): the core that guards the render loop, plus the
// checks whose names match the areas of the changed files. A changed file in no listed area runs every check.
import { readFileSync } from 'node:fs';

// Checks every fast gate runs: the app boots, idle views draw and evaluate nothing, Material Preview and Rendered
// converge. Every check also fails on a page error.
export const CORE = /^app boots$|idle|draws no( view)? frame|converges/;

// Files whose changes the build, the unit tests and the core checks cover.
const NO_SMOKE = /^(docs|bench|scripts|\.github|tools\/(docs|dev-gallery|blender-reference))\/|^tests\/(?!e2e\/)|^tests\/e2e\/(perf-guard|prod|touch|workflows)\.mjs$|\.md$|^\.git(ignore|attributes)$/;

// Source areas and the check names that exercise them. Name a check for what it does and it is picked up here.
// The shared foundations (Main and its sync, RNA, the window manager, Python) reach every editor: a broad sample.
const FOUNDATIONS = /\.blend|undo|Ctrl Z|Add |menu|Properties|Outliner|Render Image shows a|Edit Mode: Tab|G moves|orbits|Scripting|reload|Modifier/;
export const AREAS = [
  [/^src\/(sequencer|editors\/space_sequencer)\//, /Sequencer|video|Audio|sound/i],
  [/^src\/(editors|blenkernel|runtimes)\/(gpencil|grease-pencil)/, /Grease Pencil/],
  [/^src\/(bmesh|editors\/mesh|blenkernel\/(mesh|customdata|deform|multires|curveprofile)|runtimes\/shape-keys)/, /Edit Mode|tool|Knife|Inset|Loop Cut|Spin|Bisect|Cylinder|Shade|sculpt/],
  [/^src\/(editors|blenkernel)\/(curve|text)\//, /Curve|Text/],
  [/^(src\/(render|draw|imbuf|editors\/render|runtimes\/image|blenkernel\/(light|material|scene|texture|sky|colorband|colortools))|tools\/blender-nodes)\//, /Render|Material Preview|Screen Trace|shadow|draws|outline|grid|Workbench|wire|light|[Mm]aterial/],
  [/^src\/(editors\/animation|blenkernel\/(animation|armature)|runtimes\/armature)/, /Timeline|keys|Frame Rate|Render Animation|frame/],
  [/^src\/((blenkernel|makesrna|makesdna|runtime|windowmanager|python|bl_py)\/|main\.js)/, FOUNDATIONS],
  [/^src\/editors\/space_outliner\//, /Outliner|Collection/],
  [/^src\/editors\/space_buttons\//, /Properties|tab|property/],
  [/^src\/editors\/space_userpref\//, /Preferences|Emulate|Add-ons|rebound|trackpad/],
  [/^src\/editors\/(space_console|space_text)\//, /Scripting/],
  [/^src\/editors\/space_image\//, /UV Editor|Texture Paint|Render Image/],
  [/^src\/(nodes|compositor|editors\/space_node)\//, /Shader|Compositor|compositor|composite|Geometry Node|material|Material|Displace/],
  [/^src\/(io_scene_babylon|editors\/io|editors\/space_file)\//, /Import|Export|File > Open|\.blend/],
  [/^src\/editors\/interface\//, /menu|field|Properties|selector|UI unit|Inter|shortcut/],
  [/^src\/editors\/(space_view3d|transform)\//, /view|View|orbit|G moves|numpad|camera|Cursor|select/],
  [/^src\/(modifiers|editors\/object)\//, /Object|Add|Modifier|modifiers|M opens|Displace|Shade/],
  [/^src\/editors\/screen\//, /area header|[Ss]plit|workspace/],
  [/^src\/editors\/(space_topbar|space_info|undo)\//, /menu|splash|Reset|Ctrl Z|undo/],
  [/^src\/workspace\//, /example|splash|demo|reload|ZIP|Reset/],
  [/^examples\//, /example/],
];

// tests/e2e/smoke.mjs's checks as { name, line } (its `checks` entries sit at two spaces' indent), and the line that
// closes `checks`.
export function smokeChecks(source = readFileSync(new URL('../tests/e2e/smoke.mjs', import.meta.url), 'utf8')) {
  const lines = source.split('\n'), checks = [];
  lines.forEach((text, i) => {
    const name = /^  (?:async )?"([^"]+)"/.exec(text)?.[1];
    if (name) checks.push({ name, line: i + 1 });
  });
  const start = lines.findIndex((l) => l.startsWith('const checks = {'));
  return { checks, end: lines.findIndex((l, i) => i > start && l.startsWith('};')) + 1 };
}

// The checks whose lines a diff of smoke.mjs (unified, against the current file) changes; null when it changes a line
// outside them (a helper every check may use).
function editedChecks(diff, { checks, end }) {
  const edited = new Set();
  for (const [, start, count = '1'] of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    for (let line = Number(start); line < Number(start) + Math.max(1, Number(count)); line++) {
      const check = checks.findLast((c) => c.line <= line);
      if (!check || line >= end) return null;
      edited.add(check.name);
    }
  }
  return [...edited];
}

// { checks, reasons, full }: the names of the checks to run for `files` (paths from the repo root), and why.
// `smokeDiff` is the diff of tests/e2e/smoke.mjs, with no context lines (git diff -U0).
export function selectChecks(files, smoke = smokeChecks(), smokeDiff = '') {
  const names = smoke.checks.map((c) => c.name), all = (reason) => ({ checks: names, reasons: [reason], full: true });
  const picked = new Set(names.filter((n) => CORE.test(n)));
  const reasons = [];
  for (const file of files) {
    if (file === 'tests/e2e/smoke.mjs') {
      const edited = editedChecks(smokeDiff, smoke);
      if (!edited) return all(`${file}: a line outside the checks changed`);
      edited.forEach((n) => picked.add(n));
      reasons.push(`${file}: ${edited.length} edited`);
      continue;
    }
    if (NO_SMOKE.test(file)) continue;
    const area = AREAS.find(([path]) => path.test(file));
    if (!area) return all(`${file}: in no listed area`);
    const matched = names.filter((n) => area[1].test(n));
    matched.forEach((n) => picked.add(n));
    reasons.push(`${file}: ${matched.length}`);
  }
  return { checks: names.filter((n) => picked.has(n)), reasons, full: picked.size === names.length };
}
