import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPromptLibraryInstruction,
  parsePromptLibraryMarkdown
} from '../../../features/tagging/domain/index.ts';

test('parses prompt library markdown into ordered sections', () => {
  const document = parsePromptLibraryMarkdown(`
# 标注提示词库

## 角色
- 你是视频打标助手

## 规则
- 只能输出标签库中的标签
`);

  assert.equal(document.title, '标注提示词库');
  assert.equal(document.sections.length, 2);
  assert.equal(document.sections[0]?.heading, '角色');
});

test('builds prompt instruction text from parsed prompt library', () => {
  const document = parsePromptLibraryMarkdown(`
# 标注提示词库

## 角色
- 你是视频打标助手
`);

  const instruction = buildPromptLibraryInstruction(document);

  assert.equal(instruction.includes('Prompt Library: 标注提示词库'), true);
  assert.equal(instruction.includes('- 你是视频打标助手'), true);
});
