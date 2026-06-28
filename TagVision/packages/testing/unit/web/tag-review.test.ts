import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildLabelStudioImportPackage,
  parseLabelStudioReviewExport,
  parseRangeHeader,
  resolveTagReviewMediaPath,
  resolveTagReviewThumbnail,
  scanTagReviewDirectory,
  writeAcceptedTagReviewResult,
  writeTagReviewState
} from '../../../../apps/web/tag-review.ts';

test('scanTagReviewDirectory pairs valid same-directory video and json stems', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-scan-'));

  try {
    mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
    writeFileSync(path.join(tempDir, 'paired.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'paired.json'), JSON.stringify(buildStructuredTaggingJson('paired')));
    writeFileSync(path.join(tempDir, 'video-only.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'json-only.json'), JSON.stringify(buildStructuredTaggingJson('json-only')));
    writeFileSync(path.join(tempDir, 'broken.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'broken.json'), '{not-json');
    writeFileSync(path.join(tempDir, '_tag-review-state.json'), JSON.stringify({ ignored: true }));
    writeFileSync(path.join(tempDir, 'nested', 'paired-nested.webm'), 'video');
    writeFileSync(
      path.join(tempDir, 'nested', 'paired-nested.json'),
      JSON.stringify(buildStructuredTaggingJson('paired-nested'))
    );

    const result = await scanTagReviewDirectory({ directoryPath: tempDir });

    assert.deepEqual(
      result.pairedItems.map((item) => item.videoRelativePath),
      ['nested/paired-nested.webm', 'paired.mp4']
    );
    assert.deepEqual(
      result.unpairedVideos.map((item) => item.relativePath),
      ['broken.mp4', 'video-only.mp4']
    );
    assert.deepEqual(
      result.orphanJsonFiles.map((item) => item.relativePath),
      ['json-only.json']
    );
    assert.deepEqual(
      result.invalidJsonFiles.map((item) => item.relativePath),
      ['broken.json']
    );
    assert.equal(result.pairedItems[1]?.tagging.taxonomyVersion, 'Core_Prompt_V0.1');
    assert.equal(result.pairedItems[1]?.tagging.tags[0]?.labelPath.join(' > '), '表现形式 > 社媒直播 > 个人创作');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scanTagReviewDirectory overlays existing mirrored review state', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-state-'));

  try {
    writeFileSync(path.join(tempDir, 'clip.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'clip.json'), JSON.stringify(buildStructuredTaggingJson('clip')));

    const firstScan = await scanTagReviewDirectory({ directoryPath: tempDir });
    const reviewItemId = firstScan.pairedItems[0]?.reviewItemId;
    assert.ok(reviewItemId);

    await writeTagReviewState({
      directoryPath: tempDir,
      syncedAt: '2026-06-11T00:00:00.000Z',
      items: [
        {
          reviewItemId,
          videoRelativePath: 'clip.mp4',
          jsonRelativePath: 'clip.json',
          labelStudioTaskId: 42,
          status: '需修改',
          note: '主体对象不准确',
          syncedAt: '2026-06-11T00:00:00.000Z'
        }
      ]
    });

    const secondScan = await scanTagReviewDirectory({ directoryPath: tempDir });

    assert.equal(secondScan.pairedItems[0]?.reviewStatus, '需修改');
    assert.equal(secondScan.pairedItems[0]?.reviewNote, '主体对象不准确');
    assert.equal(secondScan.pairedItems[0]?.labelStudioTaskId, 42);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildLabelStudioImportPackage preserves tag evidence in markdown tasks', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-ls-'));

  try {
    writeFileSync(path.join(tempDir, 'clip.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'clip.json'), JSON.stringify(buildStructuredTaggingJson('clip')));

    const scan = await scanTagReviewDirectory({ directoryPath: tempDir });
    const payload = buildLabelStudioImportPackage({
      directoryPath: tempDir,
      mediaBaseUrl: 'http://127.0.0.1:4311/api/tag-review/media',
      items: scan.pairedItems
    });

    assert.equal(payload.taskCount, 1);
    assert.match(payload.labelConfig, /<Video name="video" value="\$video"/u);
    assert.match(payload.labelConfig, /<Choices name="review_status"/u);
    assert.match(payload.labelConfig, /<Choice value="通过"/u);
    assert.equal(payload.tasks[0]?.data.review_item_id, scan.pairedItems[0]?.reviewItemId);
    assert.match(String(payload.tasks[0]?.data.video), /directoryPath=/u);
    assert.match(String(payload.tasks[0]?.data.video), /relativePath=clip\.mp4/u);
    assert.match(String(payload.tasks[0]?.data.tag_markdown), /表现形式 > 社媒直播 > 个人创作/u);
    assert.match(String(payload.tasks[0]?.data.tag_markdown), /视频展示个人收藏品/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('parseLabelStudioReviewExport extracts review choices and notes', () => {
  const parsed = parseLabelStudioReviewExport([
    {
      id: 42,
      data: {
        review_item_id: 'review-1',
        video_relative_path: 'clip.mp4',
        json_relative_path: 'clip.json'
      },
      annotations: [
        {
          result: [
            {
              from_name: 'review_status',
              type: 'choices',
              value: { choices: ['需修改'] }
            },
            {
              from_name: 'review_note',
              type: 'textarea',
              value: { text: ['主体对象不准确'] }
            }
          ]
        }
      ]
    }
  ], '2026-06-11T00:00:00.000Z');

  assert.deepEqual(parsed, [
    {
      reviewItemId: 'review-1',
      videoRelativePath: 'clip.mp4',
      jsonRelativePath: 'clip.json',
      labelStudioTaskId: 42,
      status: '需修改',
      note: '主体对象不准确',
      syncedAt: '2026-06-11T00:00:00.000Z'
    }
  ]);
});

test('parseRangeHeader supports bounded ranges and rejects invalid ranges', () => {
  assert.deepEqual(parseRangeHeader('bytes=10-19', 100), {
    start: 10,
    end: 19,
    statusCode: 206,
    contentLength: 10,
    contentRange: 'bytes 10-19/100'
  });
  assert.deepEqual(parseRangeHeader('bytes=90-', 100), {
    start: 90,
    end: 99,
    statusCode: 206,
    contentLength: 10,
    contentRange: 'bytes 90-99/100'
  });
  assert.deepEqual(parseRangeHeader(undefined, 100), {
    start: 0,
    end: 99,
    statusCode: 200,
    contentLength: 100,
    contentRange: undefined
  });
  assert.throws(() => parseRangeHeader('bytes=100-101', 100), /Invalid range/u);
  assert.throws(() => parseRangeHeader('items=0-1', 100), /Invalid range/u);
});

test('resolveTagReviewMediaPath resolves videos inside the selected directory only', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-media-'));

  try {
    mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
    writeFileSync(path.join(tempDir, 'nested', 'clip.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'outside.mp4'), 'video');

    const media = await resolveTagReviewMediaPath({
      directoryPath: tempDir,
      relativePath: 'nested/clip.mp4'
    });

    assert.equal(media.contentType, 'video/mp4');
    assert.equal(media.fileSize, 5);
    assert.equal(media.filePath, path.join(tempDir, 'nested', 'clip.mp4'));
    await assert.rejects(
      () => resolveTagReviewMediaPath({
        directoryPath: path.join(tempDir, 'nested'),
        relativePath: '../outside.mp4'
      }),
      /escapes the selected directory/u
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveTagReviewThumbnail returns cached jpeg and rejects escaped paths', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-thumbnail-'));

  try {
    mkdirSync(path.join(tempDir, '_tagvision-thumbnails'), { recursive: true });
    writeFileSync(path.join(tempDir, 'clip.mp4'), 'video');

    const cached = await resolveTagReviewThumbnail({
      directoryPath: tempDir,
      relativePath: 'clip.mp4',
      generateIfMissing: false
    });
    writeFileSync(cached.thumbnailPath, 'jpeg');

    const thumbnail = await resolveTagReviewThumbnail({
      directoryPath: tempDir,
      relativePath: 'clip.mp4',
      generateIfMissing: false
    });

    assert.equal(thumbnail.contentType, 'image/jpeg');
    assert.equal(thumbnail.fileSize, 4);
    assert.equal(thumbnail.thumbnailPath, cached.thumbnailPath);
    assert.equal(thumbnail.thumbnailPath.startsWith(path.join(tempDir, '_tagvision-thumbnails')), true);
    await assert.rejects(
      () => resolveTagReviewThumbnail({
        directoryPath: path.join(tempDir, 'nested'),
        relativePath: '../clip.mp4',
        generateIfMissing: false
      }),
      /escapes the selected directory/u
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scanTagReviewDirectory loads taxonomy snapshot and existing accepted result', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-taxonomy-'));

  try {
    writeFileSync(path.join(tempDir, '_tagvision-taxonomy.json'), JSON.stringify({
      version: 1,
      taxonomyVersion: 'Core_Prompt_V0.1',
      taxonomyChecksum: 'sha256:test-taxonomy',
      paths: [
        '表现形式 > 社媒直播 > 个人创作',
        '内容领域 > 商业营销 > 产品广告'
      ]
    }, null, 2));
    writeFileSync(path.join(tempDir, 'clip.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'clip.json'), JSON.stringify(buildStructuredTaggingJson('clip')));
    const firstScan = await scanTagReviewDirectory({ directoryPath: tempDir });
    const reviewItemId = firstScan.pairedItems[0]?.reviewItemId;
    assert.ok(reviewItemId);
    writeFileSync(path.join(tempDir, 'clip.accepted.json'), JSON.stringify({
      version: 1,
      reviewItemId,
      videoRelativePath: 'clip.mp4',
      sourceJsonRelativePath: 'clip.json',
      taxonomyVersion: 'Core_Prompt_V0.1',
      taxonomyChecksum: 'sha256:test-taxonomy',
      status: '通过',
      acceptedPaths: ['内容领域 > 商业营销 > 产品广告'],
      source: 'manual',
      reviewedAt: '2026-06-15T00:00:00.000Z'
    }));

    const result = await scanTagReviewDirectory({ directoryPath: tempDir });

    assert.equal(result.taxonomySnapshot?.taxonomyVersion, 'Core_Prompt_V0.1');
    assert.equal(result.taxonomySnapshot?.taxonomyChecksum, 'sha256:test-taxonomy');
    assert.deepEqual(result.taxonomySnapshot?.paths, [
      '表现形式 > 社媒直播 > 个人创作',
      '内容领域 > 商业营销 > 产品广告'
    ]);
    assert.deepEqual(result.pairedItems[0]?.acceptedResult?.acceptedPaths, [
      '内容领域 > 商业营销 > 产品广告'
    ]);
    assert.equal(result.pairedItems[0]?.reviewStatus, '通过');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('scanTagReviewDirectory ignores accepted sidecars for another item or taxonomy', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-stale-accepted-'));

  try {
    writeFileSync(path.join(tempDir, '_tagvision-taxonomy.json'), JSON.stringify({
      version: 1,
      taxonomyVersion: 'Core_Prompt_V0.1',
      taxonomyChecksum: 'sha256:current-taxonomy',
      paths: ['表现形式 > 社媒直播 > 个人创作']
    }, null, 2));
    writeFileSync(path.join(tempDir, 'clip.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'clip.json'), JSON.stringify(buildStructuredTaggingJson('clip')));
    writeFileSync(path.join(tempDir, 'clip.accepted.json'), JSON.stringify({
      version: 1,
      reviewItemId: 'review-for-another-item',
      videoRelativePath: 'other.mp4',
      sourceJsonRelativePath: 'other.json',
      taxonomyVersion: 'Core_Prompt_V0.1',
      taxonomyChecksum: 'sha256:old-taxonomy',
      status: '通过',
      acceptedPaths: ['表现形式 > 社媒直播 > 个人创作'],
      source: 'manual',
      reviewedAt: '2026-06-15T00:00:00.000Z'
    }));

    const result = await scanTagReviewDirectory({ directoryPath: tempDir });

    assert.equal(result.pairedItems[0]?.acceptedResult, undefined);
    assert.equal(result.pairedItems[0]?.reviewStatus, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeAcceptedTagReviewResult rejects illegal paths and does not overwrite model json', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tag-review-accepted-'));

  try {
    writeFileSync(path.join(tempDir, '_tagvision-taxonomy.json'), JSON.stringify({
      version: 1,
      taxonomyVersion: 'Core_Prompt_V0.1',
      taxonomyChecksum: 'sha256:test-taxonomy',
      paths: ['表现形式 > 社媒直播 > 个人创作']
    }, null, 2));
    writeFileSync(path.join(tempDir, 'clip.mp4'), 'video');
    writeFileSync(path.join(tempDir, 'clip.json'), JSON.stringify(buildStructuredTaggingJson('clip')));

    const scan = await scanTagReviewDirectory({ directoryPath: tempDir });
    const item = scan.pairedItems[0];
    assert.ok(item);

    await assert.rejects(
      () => writeAcceptedTagReviewResult({
        directoryPath: tempDir,
        reviewItemId: item.reviewItemId,
        acceptedPaths: ['不存在 > 非法路径'],
        reviewedAt: '2026-06-15T00:00:00.000Z'
      }),
      /Illegal accepted taxonomy path/u
    );

    const accepted = await writeAcceptedTagReviewResult({
      directoryPath: tempDir,
      reviewItemId: item.reviewItemId,
      acceptedPaths: ['表现形式 > 社媒直播 > 个人创作'],
      reviewedAt: '2026-06-15T00:00:00.000Z'
    });

    assert.equal(accepted.status, '通过');
    assert.equal(accepted.source, 'manual');
    assert.equal(accepted.sourceJsonRelativePath, 'clip.json');
    assert.equal(readFileSync(path.join(tempDir, 'clip.json'), 'utf8'), JSON.stringify(buildStructuredTaggingJson('clip')));
    assert.match(readFileSync(path.join(tempDir, 'clip.accepted.json'), 'utf8'), /"source": "manual"/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function buildStructuredTaggingJson(segmentId: string): Record<string, unknown> {
  return {
    taxonomy_version: 'Core_Prompt_V0.1',
    segment_id: segmentId,
    review_required: false,
    review_reason: '',
    tags: [
      {
        dimension: '表现形式',
        label_path: ['表现形式', '社媒直播', '个人创作'],
        selected_level: 'l3',
        tag_role: '主标签',
        evidence_type: 'video',
        confidence_score: 0.9,
        evidence_note: '视频展示个人收藏品，带有社交平台水印和字幕，符合个人创作特征'
      }
    ]
  };
}
