import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewTransformOf, viewTransforms } from '../src/blenkernel/scene/render-babylon.js';

test('a view transform as a .blend names it maps to a Babylon tone map, AgX to the filmic one', () => {
  assert.equal(viewTransformOf('AgX'), viewTransforms.BABYLON_STANDARD);
  assert.equal(viewTransformOf('ACES 1.3'), viewTransforms.ACES);
  assert.equal(viewTransformOf('ACES'), viewTransforms.ACES);
  assert.equal(viewTransformOf('Unknown'), viewTransforms.STANDARD);
});
