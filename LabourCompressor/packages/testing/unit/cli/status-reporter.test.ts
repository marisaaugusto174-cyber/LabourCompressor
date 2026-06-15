import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCliStatusReporter,
  formatCliStageEvent
} from '../../../../apps/cli/status-reporter.ts';

test('formats cli stage events', () => {
  assert.equal(
    formatCliStageEvent({
      stage: 'download',
      status: 'running',
      message: 'Starting batch'
    }),
    '[RUNNING] download: Starting batch'
  );
});

test('routes failed cli events to error output', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const reporter = createCliStatusReporter({
    log: (line) => logs.push(line),
    error: (line) => errors.push(line)
  });

  reporter.report({
    stage: 'download',
    status: 'failed',
    message: 'network timeout'
  });

  assert.equal(logs.length, 0);
  assert.equal(errors[0], '[FAILED] download: network timeout');
});
