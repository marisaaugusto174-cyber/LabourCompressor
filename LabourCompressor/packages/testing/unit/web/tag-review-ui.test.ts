import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const stylesCss = readFileSync(
  path.join(process.cwd(), 'apps/web/public/styles.css'),
  'utf8'
);
const indexHtml = readFileSync(
  path.join(process.cwd(), 'apps/web/public/index.html'),
  'utf8'
);
const appJs = readFileSync(
  path.join(process.cwd(), 'apps/web/public/app.js'),
  'utf8'
);
const tagVisionLaunchPath = path.join(process.cwd(), 'apps/web/public/tagvision-launch.js');
const tagVisionLaunchJs = existsSync(tagVisionLaunchPath)
  ? readFileSync(tagVisionLaunchPath, 'utf8')
  : '';

test('legacy LabourCompressor review page is retired from the public app', () => {
  assert.equal(existsSync(path.join(process.cwd(), 'apps/web/public/review.html')), false);
  assert.equal(indexHtml.includes('href="/review.html"'), false);
  assert.equal(indexHtml.includes('src="/tag-review.js'), false);
  assert.equal(indexHtml.includes('打标质检'), true);
});

test('main web ui starts TagVision instead of linking to an internal review page', () => {
  assert.match(indexHtml, /id="launch-tagvision"/u);
  assert.match(indexHtml, /aria-describedby="tagvision-launch-status"/u);
  assert.match(indexHtml, /id="tagvision-launch-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/u);
  assert.equal(existsSync(tagVisionLaunchPath), true);
  assert.match(appJs, /import \{ initTagVisionLaunch \} from '\.\/tagvision-launch\.js';/u);
  assert.match(appJs, /initTagVisionLaunch\(\{ apiPost \}\);/u);
  assert.match(tagVisionLaunchJs, /document\.querySelector\('#launch-tagvision'\)/u);
  assert.match(tagVisionLaunchJs, /document\.querySelector\('#tagvision-launch-status'\)/u);
  assert.match(tagVisionLaunchJs, /apiPost\('\/api\/tagvision\/launch'/u);
  assert.match(tagVisionLaunchJs, /http:\/\/127\.0\.0\.1:4312\/review\.html/u);
  assert.match(stylesCss, /\.tagvision-launch-status\[hidden\]\s*\{[^}]*display:\s*none/su);
});
