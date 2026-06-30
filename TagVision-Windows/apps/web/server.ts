import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleTagReviewRoutes } from './api/routes/tag-review.ts';
import { readJsonBody, readString, serveStatic, sendJson } from './api/http.ts';
import { chooseLocalPath } from './local-dialogs.ts';

const WEB_PORT = Number(process.env.TAGVISION_WEB_PORT ?? '4312');
const WEB_HOST = process.env.TAGVISION_WEB_HOST ?? '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const DEFAULT_REVIEW_DIRECTORY = process.env.TAGVISION_REVIEW_DIR ?? '';
const require = createRequire(import.meta.url);
const PLYR_DIST_DIR = path.dirname(require.resolve('plyr'));
const PLYR_ASSETS: Readonly<Record<string, readonly [fileName: string, contentType: string]>> = Object.freeze({
  '/vendor/plyr.js': ['plyr.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/plyr.css': ['plyr.css', 'text/css; charset=utf-8'],
  '/vendor/plyr.svg': ['plyr.svg', 'image/svg+xml']
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${WEB_HOST}:${WEB_PORT}`}`);
  const context = {
    webHost: WEB_HOST,
    webPort: WEB_PORT,
    publicDir: PUBLIC_DIR,
    defaultReviewDirectory: DEFAULT_REVIEW_DIRECTORY
  };

  try {
    if (request.method === 'GET' && url.pathname === '/api/defaults') {
      sendJson(response, {
        defaults: {
          reviewDirectory: context.defaultReviewDirectory
        }
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/dialog/open-folder') {
      const body = await readJsonBody(request);
      const defaultPath = readString(body.defaultPath);
      sendJson(
        response,
        await chooseLocalPath({
          kind: 'folder',
          prompt: readString(body.prompt) || '选择文件夹',
          ...(defaultPath.length === 0 ? {} : { defaultPath })
        })
      );
      return;
    }

    if (await handleTagReviewRoutes({ request, response, url, context })) {
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      await serveStatic(response, PUBLIC_DIR, 'index.html', 'text/html; charset=utf-8');
      return;
    }

    if (url.pathname === '/review.html') {
      await serveStatic(response, PUBLIC_DIR, 'review.html', 'text/html; charset=utf-8');
      return;
    }

    const plyrAsset = PLYR_ASSETS[url.pathname];
    if (plyrAsset !== undefined) {
      await serveStatic(response, PLYR_DIST_DIR, plyrAsset[0], plyrAsset[1]);
      return;
    }

    if (/^\/[a-z0-9-]+\.js$/u.test(url.pathname)) {
      await serveStatic(response, PUBLIC_DIR, url.pathname.slice(1), 'text/javascript; charset=utf-8');
      return;
    }

    if (url.pathname === '/styles.css') {
      await serveStatic(response, PUBLIC_DIR, 'styles.css', 'text/css; charset=utf-8');
      return;
    }

    sendJson(response, { error: 'Not found' }, 404);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.listen(WEB_PORT, WEB_HOST, () => {
  console.log(`TagVision Web UI: http://${WEB_HOST}:${WEB_PORT}/review.html`);
});
