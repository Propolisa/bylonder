import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CORE, selectChecks, smokeChecks } from '../scripts/smoke-select.mjs';

const smoke = smokeChecks();
const names = smoke.checks.map((c) => c.name);
const core = names.filter((n) => CORE.test(n));

test('the smoke checks are read from smoke.mjs, and the core guards the render loop', () => {
  assert.ok(names.length > 80, `${names.length} checks`);
  assert.equal(new Set(names).size, names.length, 'check names are unique');
  for (const guard of [/^app boots$/, /idle Rendered view of an opened \.blend draws no frame/, /evaluates and saves nothing/,
    /startup scene's idle Rendered view/, /Material Preview converges/]) assert.ok(core.some((n) => guard.test(n)), `core has ${guard}`);
  assert.ok(core.length < 10, `core: ${core.length}`);
});

test('docs and unit tests run the core only; an area adds its checks; an unknown file runs everything', () => {
  assert.deepEqual(selectChecks(['docs/features/x.md', 'tests/x.test.js', 'scripts/gates.mjs'], smoke).checks, core);
  const sequencer = selectChecks(['src/sequencer/strips.js'], smoke);
  assert.ok(sequencer.checks.some((n) => /Video Sequencer/.test(n)) && !sequencer.full);
  assert.ok(!sequencer.checks.some((n) => /Grease Pencil/.test(n)));
  assert.ok(selectChecks(['src/blenkernel/main-sync.js'], smoke).checks.length < names.length / 2);
  const unknown = selectChecks(['eslint.config.js'], smoke);
  assert.ok(unknown.full && unknown.checks.length === names.length);
  assert.match(unknown.reasons[0], /eslint\.config\.js/);
});

test('an edit of smoke.mjs runs the checks it touches, or everything when it touches a helper', () => {
  const target = smoke.checks.find((c) => /Grease Pencil draws, fills/.test(c.name));
  const inside = selectChecks(['tests/e2e/smoke.mjs'], smoke, `@@ -1 +${target.line + 2},2 @@\n+x\n+y\n`);
  assert.deepEqual(inside.checks.filter((n) => !core.includes(n)), [target.name]);
  assert.ok(selectChecks(['tests/e2e/smoke.mjs'], smoke, `@@ -1 +${smoke.end + 5} @@\n+x\n`).full);
  assert.ok(selectChecks(['tests/e2e/smoke.mjs'], smoke, '@@ -1 +3 @@\n+x\n').full);
});
