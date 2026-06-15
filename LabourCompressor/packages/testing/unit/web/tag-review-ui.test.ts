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

test('main web ui links to the tag review page', () => {
  assert.equal(indexHtml.includes('href="/review.html"'), true);
  assert.equal(indexHtml.includes('打标质检'), true);
});

test('review detail opens as a fixed fullscreen modal and disables page autoload', () => {
  assert.match(reviewHtml, /id="detail-view"[^>]*review-detail-modal/u);
  assert.match(stylesCss, /\.review-detail-modal\s*\{[^}]*position:\s*fixed/su);
  assert.match(stylesCss, /\.is-review-modal-open\s*\{[^}]*overflow:\s*hidden/su);
  assert.equal(reviewJs.includes("document.body.classList.add('is-review-modal-open')"), true);
  assert.match(reviewJs, /function maybeAutoLoadMore\(\)\s*\{[\s\S]*?if \(isDetailOpen\(\)\) \{/u);
  assert.equal(reviewJs.includes('scrollIntoView'), false);
});
