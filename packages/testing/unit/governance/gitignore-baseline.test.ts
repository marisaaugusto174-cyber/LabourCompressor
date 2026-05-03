import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const GITIGNORE_PATH = path.join(PROJECT_ROOT, '.gitignore');

test('.gitignore covers local runtime artifacts and sensitive local configs', async () => {
  const gitignore = await readFile(GITIGNORE_PATH, 'utf8');

  for (const expectedEntry of [
    '.cache',
    '.runtime-state',
    '.runtime-uploads',
    '.web-ui.log',
    '.web-ui.pid',
    '.DS_Store',
    '*.local.json',
    'node_modules',
    '.tools',
    '视频数据下载缓存',
    '视频数据采集总表.xlsx'
  ]) {
    assert.match(
      gitignore,
      new RegExp(`(^|\\n)${escapeRegExp(expectedEntry)}(\\n|$)`),
      `missing ${expectedEntry} in .gitignore`
    );
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
