import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPlatformCredentialEntry,
  parsePlatformCredentialConfig
} from '../../../features/download/domain/index.ts';

test('parses xiaohongshu platform credentials', () => {
  const config = parsePlatformCredentialConfig({
    xiaohongshu: {
      cookiesFilePath: ' /tmp/xiaohongshu.txt '
    }
  });

  assert.deepEqual(getPlatformCredentialEntry(config, 'xiaohongshu'), {
    cookiesFilePath: '/tmp/xiaohongshu.txt',
    cookiesFromBrowser: undefined
  });
});
