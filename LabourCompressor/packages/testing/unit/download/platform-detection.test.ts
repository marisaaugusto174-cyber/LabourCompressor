import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectSupportedPlatformUrl,
  sanitizePlatformUrlForOutput
} from '../../../features/download/domain/index.ts';

test('detects youtube and normalizes url', () => {
  const detected = detectSupportedPlatformUrl('https://www.youtube.com/watch?v=abc');

  assert.equal(detected.platform, 'youtube');
  assert.equal(detected.host, 'www.youtube.com');
});

test('detects bilibili short domain', () => {
  const detected = detectSupportedPlatformUrl('https://b23.tv/example');

  assert.equal(detected.platform, 'bilibili');
});

test('normalizes douyin shipin url to video url', () => {
  const detected = detectSupportedPlatformUrl(
    'https://www.douyin.com/shipin/7262945903315568677'
  );

  assert.equal(
    detected.normalizedUrl,
    'https://www.douyin.com/video/7262945903315568677'
  );
});

test('normalizes douyin share landing url to canonical video url', () => {
  const detected = detectSupportedPlatformUrl(
    'https://www.iesdouyin.com/share/video/7636717753054891300/?region=CN&from=web_code_link'
  );

  assert.equal(detected.platform, 'douyin');
  assert.equal(
    detected.normalizedUrl,
    'https://www.douyin.com/video/7636717753054891300'
  );
});

test('rejects unsupported platform host', () => {
  assert.throws(
    () => detectSupportedPlatformUrl('https://example.com/video'),
    /Unsupported download platform host/
  );
});

test('detects xiaohongshu explore urls without dropping access query parameters', () => {
  const sourceUrl =
    'https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01?xsec_token=redacted&xsec_source=pc_feed';
  const detected = detectSupportedPlatformUrl(sourceUrl);

  assert.equal(detected.platform, 'xiaohongshu');
  assert.equal(detected.normalizedUrl, sourceUrl);
});

test('detects xiaohongshu discovery item urls and rejects non-note paths', () => {
  assert.equal(
    detectSupportedPlatformUrl(
      'https://www.xiaohongshu.com/discovery/item/abcdef0123456789abcdef01'
    ).platform,
    'xiaohongshu'
  );
  assert.throws(
    () => detectSupportedPlatformUrl('https://www.xiaohongshu.com/user/profile/example'),
    /Unsupported download platform/u
  );
});

test('removes Xiaohongshu access query parameters from persisted and displayed urls', () => {
  assert.equal(
    sanitizePlatformUrlForOutput(
      'https://www.xiaohongshu.com/explore/abc123?xsec_token=secret&xsec_source=pc_feed'
    ),
    'https://www.xiaohongshu.com/explore/abc123'
  );
  assert.equal(
    sanitizePlatformUrlForOutput('https://www.youtube.com/watch?v=public-id'),
    'https://www.youtube.com/watch?v=public-id'
  );
});
