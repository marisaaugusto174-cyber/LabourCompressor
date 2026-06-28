import test from 'node:test';
import assert from 'node:assert/strict';

import { humanizeDownloadFailure } from '../../../../apps/cli/local-pipeline-after-edit.ts';

test('humanizes Xiaohongshu page and note failures', () => {
  assert.match(
    humanizeDownloadFailure('xiaohongshu-note-not-video', 'raw'),
    /不包含视频/u
  );
  assert.match(
    humanizeDownloadFailure('xiaohongshu-page-unavailable', 'raw'),
    /页面暂时不可用/u
  );
});
