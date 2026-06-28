import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { apiPost } from '../../../../apps/web/public/api-client.js';

test('apiPost rejects with a timeout when the local service does not answer', async () => {
  const server = createServer((_request, _response) => {
    // Leave the request open to exercise client-side timeout handling.
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    assert.equal(typeof address, 'object');
    assert.notEqual(address, null);
    await assert.rejects(
      apiPost(`http://127.0.0.1:${address.port}/slow`, {}, { timeoutMs: 50 }),
      /请求超时|timed out/iu
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
