import { createReadStream } from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import {
  buildLabelStudioImportPackage,
  parseLabelStudioReviewExport,
  parseRangeHeader,
  resolveTagReviewMediaPath,
  scanTagReviewDirectory,
  writeTagReviewState
} from '../../tag-review.ts';
import {
  fetchLabelStudioExport,
  importLabelStudioTasks
} from '../../services/label-studio.ts';
import {
  buildCorsHeaders,
  buildLocalUrl,
  readJsonBody,
  readString,
  requireBodyString,
  requireQueryString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleTagReviewRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'POST' && url.pathname === '/api/tag-review/scan') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await scanTagReviewDirectory({
        directoryPath: requireBodyString(body, 'directoryPath')
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/tag-review/label-studio/package') {
    const body = await readJsonBody(request);
    const directoryPath = requireBodyString(body, 'directoryPath');
    const scan = await scanTagReviewDirectory({ directoryPath });
    sendJson(
      response,
      buildLabelStudioImportPackage({
        directoryPath,
        mediaBaseUrl: readString(body.mediaBaseUrl) || buildLocalUrl(request, context, '/api/tag-review/media'),
        items: scan.pairedItems
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/tag-review/label-studio/import') {
    const body = await readJsonBody(request);
    const directoryPath = requireBodyString(body, 'directoryPath');
    const scan = await scanTagReviewDirectory({ directoryPath });
    const importPackage = buildLabelStudioImportPackage({
      directoryPath,
      mediaBaseUrl: readString(body.mediaBaseUrl) || buildLocalUrl(request, context, '/api/tag-review/media'),
      items: scan.pairedItems
    });

    sendJson(
      response,
      await importLabelStudioTasks({
        labelStudioUrl: requireBodyString(body, 'labelStudioUrl'),
        token: requireBodyString(body, 'token'),
        projectId: readString(body.projectId) || undefined,
        projectTitle: readString(body.projectTitle) || `Tag Review ${new Date().toISOString()}`,
        importPackage
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/tag-review/label-studio/sync') {
    const body = await readJsonBody(request);
    const directoryPath = requireBodyString(body, 'directoryPath');
    const syncedAt = new Date().toISOString();
    const exportPayload = await fetchLabelStudioExport({
      labelStudioUrl: requireBodyString(body, 'labelStudioUrl'),
      token: requireBodyString(body, 'token'),
      projectId: requireBodyString(body, 'projectId')
    });
    const items = parseLabelStudioReviewExport(exportPayload, syncedAt);
    const state = await writeTagReviewState({
      directoryPath,
      syncedAt,
      items
    });

    sendJson(response, {
      syncedAt,
      updatedItems: items.length,
      stateFilePath: path.join(path.resolve(directoryPath), '_tag-review-state.json'),
      state
    });
    return true;
  }

  if (request.method === 'OPTIONS' && url.pathname === '/api/tag-review/media') {
    response.writeHead(204, buildCorsHeaders());
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/tag-review/media') {
    await serveTagReviewMedia(request, response, url);
    return true;
  }

  return false;
};

async function serveTagReviewMedia(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const media = await resolveTagReviewMediaPath({
    directoryPath: requireQueryString(url, 'directoryPath'),
    relativePath: requireQueryString(url, 'relativePath')
  });

  let range;

  try {
    range = parseRangeHeader(request.headers.range, media.fileSize);
  } catch {
    response.writeHead(416, {
      ...buildCorsHeaders(),
      'Content-Range': `bytes */${media.fileSize}`,
      'Content-Length': '0'
    });
    response.end();
    return;
  }

  response.writeHead(range.statusCode, {
    ...buildCorsHeaders(),
    'Content-Type': media.contentType,
    'Content-Length': String(range.contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...(range.contentRange === undefined ? {} : { 'Content-Range': range.contentRange })
  });

  const stream = createReadStream(media.filePath, {
    start: range.start,
    end: range.end
  });
  stream.on('error', (error) => {
    response.destroy(error);
  });
  stream.pipe(response);
}
