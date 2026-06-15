import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SERVER_PATH = path.join(PROJECT_ROOT, 'apps/web/server.ts');

test('web server does not log preflight request bodies', async () => {
  const source = await readFile(SERVER_PATH, 'utf8');

  assert.doesNotMatch(source, /PRELIGHT_BODY/);
  assert.doesNotMatch(
    source,
    /console\.log\(\s*['"`][^'"`]*preflight[^'"`]*['"`]\s*,\s*JSON\.stringify\(/i
  );
});
