import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';

import { dispatchWebRoute } from '../../../../apps/web/api/routes/index.ts';

test('tagvision launch route delegates to the configured launcher', async () => {
  let launchCalls = 0;
  const server = createRouteServer({
    tagVisionLauncher: {
      async launch() {
        launchCalls += 1;
        return {
          status: 'started',
          url: 'http://127.0.0.1:4312/review.html'
        };
      }
    }
  });

  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/tagvision/launch`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(launchCalls, 1);
    assert.deepEqual(body, {
      status: 'started',
      url: 'http://127.0.0.1:4312/review.html'
    });
  } finally {
    await close(server);
  }
});

test('legacy review page is not served by LabourCompressor static routes', async () => {
  const server = createRouteServer();
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/review.html`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: 'Not found.' });
  } finally {
    await close(server);
  }
});

test('legacy tag review api is not exposed by LabourCompressor routes', async () => {
  const server = createRouteServer();
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/api/tag-review/scan`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: 'Not found.' });
  } finally {
    await close(server);
  }
});

function createRouteServer(overrides: Record<string, unknown> = {}) {
  return createServer((request, response) => {
    void dispatchWebRoute({
      request,
      response,
      url: new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`),
      context: {
        webHost: '127.0.0.1',
        webPort: 4311,
        publicDir: path.join(process.cwd(), 'apps/web/public'),
        defaultMasterSpreadsheet: '',
        defaultProviderConfig: '',
        defaultPlatformCredentialConfig: '',
        defaultCacheRoot: '',
        uploadsDir: '',
        taskService: {},
        ...overrides
      } as never
    });
  });
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
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
