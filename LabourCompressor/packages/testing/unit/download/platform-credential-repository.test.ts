import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPlatformCredentialFileRepository } from '../../../adapters/storage/filesystem/platform-credential-repository.ts';

test('imports cookies into managed storage and restores the platform summary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lc-credential-repository-'));
  const source = path.join(root, 'source.txt');
  await writeFile(source, '.xiaohongshu.com\tTRUE\t/\tTRUE\t0\ta1\tv1\n', 'utf8');
  const repository = createPlatformCredentialFileRepository({
    configFilePath: path.join(root, 'credentials.json'),
    repositoryRoot: path.join(root, 'managed')
  });

  try {
    const imported = await repository.importFile({
      platform: 'xiaohongshu',
      sourceCookiesFilePath: source,
      now: new Date('2026-06-28T00:00:00.000Z')
    });
    const restored = await repository.list();

    assert.equal(imported[4]?.platform, 'xiaohongshu');
    assert.match(restored[4]?.cookiesFilePath ?? '', /managed.*xiaohongshu.*cookies\.txt/u);
    assert.equal(restored[4]?.credentialUploadedAt, '2026-06-28T00:00:00.000Z');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
