import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadPromptPresetRepository } from '../../../../apps/cli/prompt-presets.ts';

test('loadPromptPresetRepository reads prompt preset manifests', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'prompt-presets-'));

  try {
    writeFileSync(path.join(tempDir, 'prompt.md'), '# Prompt\n');
    writeFileSync(
      path.join(tempDir, 'prompt.json'),
      JSON.stringify({
        id: 'project-prompt',
        label: 'Project Prompt',
        filePath: 'prompt.md'
      })
    );

    const presets = loadPromptPresetRepository(tempDir);

    assert.equal(presets.length, 1);
    assert.equal(presets[0]?.id, 'project-prompt');
    assert.equal(presets[0]?.label, 'Project Prompt');
    assert.equal(presets[0]?.filePath, path.join(tempDir, 'prompt.md'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadPromptPresetRepository rejects missing filePath', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'prompt-presets-invalid-'));

  try {
    writeFileSync(
      path.join(tempDir, 'prompt.json'),
      JSON.stringify({
        id: 'project-prompt',
        label: 'Project Prompt'
      })
    );

    assert.throws(
      () => loadPromptPresetRepository(tempDir),
      /Missing filePath/u
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
