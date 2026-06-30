import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyVideoOrientation,
  fitVideoSize
} from '../../../../apps/web/public/review-layout.js';

test('review layout classifies landscape portrait and square video', () => {
  assert.equal(classifyVideoOrientation(1920, 1080), 'landscape');
  assert.equal(classifyVideoOrientation(1080, 1920), 'portrait');
  assert.equal(classifyVideoOrientation(1000, 1000), 'square');
  assert.equal(classifyVideoOrientation(1200, 1000), 'square');
  assert.equal(classifyVideoOrientation(800, 1000), 'square');
});

test('review layout fits video inside the available area without changing its ratio', () => {
  assert.deepEqual(fitVideoSize({
    videoWidth: 1920,
    videoHeight: 1080,
    availableWidth: 1000,
    availableHeight: 800
  }), { width: 1000, height: 563 });

  assert.deepEqual(fitVideoSize({
    videoWidth: 1080,
    videoHeight: 1920,
    availableWidth: 700,
    availableHeight: 800
  }), { width: 450, height: 800 });
});

test('review layout uses safe fallback dimensions for missing metadata', () => {
  assert.deepEqual(fitVideoSize({
    videoWidth: 0,
    videoHeight: 0,
    availableWidth: 640,
    availableHeight: 360
  }), { width: 640, height: 360 });
});
