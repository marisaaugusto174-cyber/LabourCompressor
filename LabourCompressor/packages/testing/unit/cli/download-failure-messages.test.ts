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
  assert.match(
    humanizeDownloadFailure('xiaohongshu-media-type-invalid', 'raw'),
    /非视频内容/u
  );
  assert.match(
    humanizeDownloadFailure('xiaohongshu-media-truncated', 'raw'),
    /内容不完整/u
  );
});
