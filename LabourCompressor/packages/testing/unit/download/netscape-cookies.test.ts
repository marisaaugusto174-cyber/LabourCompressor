import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  readNetscapeCookieHeader
} from '../../../adapters/downloaders/netscape-cookies.ts';

test('builds a domain-scoped header from regular and HttpOnly Netscape cookies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lc-cookies-'));
  const filePath = path.join(directory, 'cookies.txt');

  try {
    await writeFile(filePath, [
      '# Netscape HTTP Cookie File',
      '.xiaohongshu.com\tTRUE\t/\tTRUE\t1893456000\ta1\tv1',
      '#HttpOnly_.xiaohongshu.com\tTRUE\t/\tTRUE\t1893456000\ta2\tv2',
      '.notxiaohongshu.com\tTRUE\t/\tTRUE\t1893456000\tbad\tleak',
      '.xiaohongshu.com\tTRUE\t/\tTRUE\t1\texpired\told'
    ].join('\n'), 'utf8');

    assert.equal(
      await readNetscapeCookieHeader(
        filePath,
        ['xiaohongshu.com'],
        new Date('2026-06-28T00:00:00.000Z')
      ),
      'a1=v1; a2=v2'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns an empty header for missing cookie files', async () => {
  assert.equal(
    await readNetscapeCookieHeader('/missing/cookies.txt', ['xiaohongshu.com']),
    ''
  );
});
