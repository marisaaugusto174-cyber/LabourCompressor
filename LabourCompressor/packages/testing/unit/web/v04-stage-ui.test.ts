import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const html = readFileSync(
  path.join(process.cwd(), 'apps/web/public/index.html'),
  'utf8'
);

test('v0.4 web ui exposes five default stage buttons and folds full pipeline entry', () => {
  for (const stage of ['download', 'segment', 'compress', 'tag', 'archive']) {
    assert.equal(
      html.includes(`data-pipeline-stage="${stage}"`),
      true,
      `missing stage button for ${stage}`
    );
  }

  assert.equal(html.includes('<details class="advanced-run-panel">'), true);
  assert.equal(html.includes('data-pipeline-stage="all"'), true);
});

test('web ui exposes a taxonomy preset selector instead of a hidden fixed preset', () => {
  assert.equal(html.includes('id="taxonomy-preset"'), true);
  assert.equal(html.includes('<select id="taxonomy-preset" name="taxonomyPreset"'), true);
  assert.equal(html.includes('type="hidden" name="taxonomyPreset"'), false);
});

test('web ui exposes runtime task control buttons', () => {
  assert.equal(html.includes('id="pause-task"'), true);
  assert.equal(html.includes('id="resume-task"'), true);
  assert.equal(html.includes('id="stop-task"'), true);
  assert.equal(html.includes('id="partial-writeback"'), true);
});

test('web ui exposes AfterEdit batch sample import controls', () => {
  assert.equal(html.includes('id="afterEditBatchSampleFile"'), true);
  assert.equal(html.includes('name="afterEditBatchSampleFile"'), true);
  assert.equal(html.includes('id="build-afteredit-batch-sheet"'), true);
});
