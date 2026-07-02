import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (filePath: string) => readFileSync(path.join(process.cwd(), filePath), 'utf8');

test('project metadata and main UI are locked to V0.5', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const html = read('apps/web/public/index.html');
  const macosBundle = read('packages/features/desktop/domain/macos-app-bundle.ts');

  assert.equal(packageJson.version, '0.5.1');
  assert.equal(packageLock.version, '0.5.1');
  assert.equal(packageLock.packages[''].version, '0.5.1');
  assert.match(html, /<span class="build-version">V0\.5<\/span>/u);
  assert.match(macosBundle, /CFBundleShortVersionString<\/key>\s*<string>0\.5<\/string>/u);
});

test('current product documents point to the V0.5 release baseline', () => {
  for (const filePath of ['PRD.md', '01_PROJECT_CHARTER.md', '03_STRICT_RULES.md', '04_STATE_AND_DATA.md', 'TASKLIST.md']) {
    assert.match(read(filePath), /(?:Current Product Version|Product Version|当前版本)[:：]?\s*`v0\.5`/u, filePath);
  }

  assert.match(read('README.md'), /docs\/release\/V0\.5_RELEASE_NOTES\.md/u);
  assert.match(read('README.md'), /v0\.5\.1/u);
  assert.match(read('docs/release/V0.5_RELEASE_NOTES.md'), /^# V0\.5 Release Notes/mu);
});
