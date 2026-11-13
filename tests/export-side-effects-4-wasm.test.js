// Time limit: 1200 s
// Batch 4 of the examples whose exported packages must load alone, as shipped and bundled (export-side-effects.js).
import assert from 'node:assert/strict';
import { failingExamples } from './export-side-effects.js';

const { examples, failures } = failingExamples(3);
assert.deepEqual(failures, [], 'every example package loads alone');
console.log(`Export side effects 4: ${examples.length} examples' packages load alone, as shipped and bundled`);
