import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const reviewHtml = readFileSync(
  path.join(process.cwd(), 'apps/web/public/review.html'),
  'utf8'
);
const reviewJs = readFileSync(
  path.join(process.cwd(), 'apps/web/public/tag-review.js'),
  'utf8'
);
const stylesCss = readFileSync(
  path.join(process.cwd(), 'apps/web/public/styles.css'),
  'utf8'
);
const indexHtml = readFileSync(
  path.join(process.cwd(), 'apps/web/public/index.html'),
  'utf8'
);

test('review ui exposes directory scan and Label Studio controls', () => {
  for (const id of [
    'mode-tag-review',
    'mode-problem-review',
    'review-directory',
    'scan-button',
    'download-ls-package',
    'ls-url',
    'ls-token',
    'ls-project-id',
    'import-ls',
    'sync-ls',
    'review-grid',
    'detail-view'
  ]) {
    assert.equal(reviewHtml.includes(`id="${id}"`), true, `missing #${id}`);
  }

  assert.equal(reviewHtml.includes('src="/tag-review.js'), true);
});

test('review ui exposes problem review queue actions', () => {
  for (const id of [
    'decision-discard',
    'decision-keep-afteredit',
    'decision-keep-problem',
    'decision-manual-retry'
  ]) {
    assert.equal(reviewHtml.includes(`id="${id}"`), true, `missing #${id}`);
  }

  assert.equal(reviewJs.includes('/api/review-queue/scan'), true);
  assert.equal(reviewJs.includes('/api/review-queue/decision'), true);
  assert.equal(reviewJs.includes('keep-afteredit'), true);
  assert.equal(reviewJs.includes('manual-retry'), true);
});

test('main web ui links to the tag review page', () => {
  assert.equal(indexHtml.includes('href="/review.html"'), true);
  assert.equal(indexHtml.includes('打标质检'), true);
});

test('review ui avoids introductory and explanatory copy', () => {
  for (const text of [
    '扫描同名视频和 JSON',
    'Review UI build:',
    'Local sidecar JSON',
    '只读取并扫描目录',
    '递归扫描视频与同目录同名 JSON。',
    '滚动时增量加载卡片',
    '请选择目录并扫描。',
    '未配对文件和接口结果显示在这里。',
    '暂无诊断信息。'
  ]) {
    assert.equal(reviewHtml.includes(text), false, `unexpected explanatory copy: ${text}`);
  }
});

test('review detail opens as a fixed fullscreen modal and disables page autoload', () => {
  assert.match(reviewHtml, /id="detail-view"[^>]*review-detail-modal/u);
  assert.match(stylesCss, /\.review-detail-modal\s*\{[^}]*position:\s*fixed/su);
  assert.match(stylesCss, /\.is-review-modal-open\s*\{[^}]*overflow:\s*hidden/su);
  assert.equal(reviewJs.includes("document.body.classList.add('is-review-modal-open')"), true);
  assert.match(reviewJs, /function maybeAutoLoadMore\(\)\s*\{[\s\S]*?if \(isDetailOpen\(\)\) \{/u);
  assert.equal(reviewJs.includes('scrollIntoView'), false);
});
