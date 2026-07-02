import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');

test('README and PRD align on V0.5.1 model pool and spreadsheet scope', async () => {
  const readme = await readProjectFile('README.md');
  const prd = await readProjectFile('PRD.md');

  for (const doc of [readme, prd]) {
    assert.match(doc, /Qwen3\.7Plus/u);
    assert.match(doc, /Qwen3\.6Flash/u);
    assert.match(doc, /Gemini 3\.5 Flash/u);
    assert.doesNotMatch(doc, /Qwen 3\.5 Plus/u);
    assert.doesNotMatch(doc, /Gemini 3 Flash Thinking/u);
    assert.match(doc, /Numbers[\s\S]{0,80}读取兼容/u);
    assert.match(doc, /csv[\s\S]{0,80}失败导出/u);
  }
});

test('PRD makes automatic segmentation the V0.5.1 acceptance path', async () => {
  const prd = await readProjectFile('PRD.md');

  assert.match(prd, /当前版本：`v0\.5\.1`/u);
  assert.match(prd, /下载 -> 自动分割 -> 片段级视频打标 -> 回表归档/u);
  assert.doesNotMatch(prd, /V0\.2 的验收链路固定为/u);
});

test('README documents migration cold-start prerequisites and private credential boundary', async () => {
  const readme = await readProjectFile('README.md');

  for (const expected of [
    '源码包 + 一键启动器',
    'macOS Apple Silicon',
    'Xcode Command Line Tools',
    'Node.js 22+',
    'Homebrew',
    'npm、Homebrew、PyPI、模型 provider',
    '首次启动后在 Web UI 填入',
    '不随包分发'
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(expected), 'u'));
  }
});

async function readProjectFile(relativePath: string): Promise<string> {
  return readFile(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
