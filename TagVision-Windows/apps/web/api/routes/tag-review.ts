import { createReadStream } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import {
  parseRangeHeader,
  resolveTagReviewMediaPath,
  resolveTagReviewThumbnail,
  scanTagReviewDirectory,
  writeAcceptedTagReviewResult
} from '../../tag-review.ts';
import {
  buildCorsHeaders,
  readJsonBody,
  readString,
  requireBodyString,
  requireQueryString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleTagReviewRoutes: WebRouteHandler = async ({ request, response, url }) => {
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

  if (request.method === 'POST' && url.pathname === '/api/tag-review/accepted') {
    const body = await readJsonBody(request);
    const reviewedAt = readString(body.reviewedAt);
    sendJson(
      response,
      await writeAcceptedTagReviewResult({
        directoryPath: requireBodyString(body, 'directoryPath'),
        reviewItemId: requireBodyString(body, 'reviewItemId'),
        acceptedPaths: Array.isArray(body.acceptedPaths)
          ? body.acceptedPaths.map((value) => readString(value)).filter((value) => value.length > 0)
          : [],
        ...(reviewedAt.length === 0 ? {} : { reviewedAt })
      })
    );
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

  if (request.method === 'GET' && url.pathname === '/api/tag-review/thumbnail') {
    await serveTagReviewThumbnail(response, url);
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
  stream.on('error', (error: Error) => {
    response.destroy(error);
  });
  stream.pipe(response);
}

async function serveTagReviewThumbnail(
  response: ServerResponse,
  url: URL
): Promise<void> {
  const thumbnail = await resolveTagReviewThumbnail({
    directoryPath: requireQueryString(url, 'directoryPath'),
    relativePath: requireQueryString(url, 'relativePath')
  });

  response.writeHead(200, {
    ...buildCorsHeaders(),
    'Content-Type': thumbnail.contentType,
    'Content-Length': String(thumbnail.fileSize),
    'Cache-Control': 'no-store'
  });

  const stream = createReadStream(thumbnail.thumbnailPath);
  stream.on('error', (error: Error) => {
    response.destroy(error);
  });
  stream.pipe(response);
}
