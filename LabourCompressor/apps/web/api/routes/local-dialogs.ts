import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chooseLocalPath } from '../../runtime-support.ts';
import {
  readBinaryBody,
  readJsonBody,
  readString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleLocalDialogRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'POST' && url.pathname === '/api/dialog/open-file') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await chooseLocalPath({
        kind: 'file',
        prompt: readString(body.prompt) || '选择文件',
        defaultPath: readString(body.defaultPath) || undefined
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/dialog/open-folder') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await chooseLocalPath({
        kind: 'folder',
        prompt: readString(body.prompt) || '选择文件夹',
        defaultPath: readString(body.defaultPath) || undefined
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/upload-file') {
    const fileName = sanitizeUploadedFileName(url.searchParams.get('fileName') ?? 'uploaded.bin');
    const filePath = path.join(context.uploadsDir, `${Date.now()}-${fileName}`);
    const body = await readBinaryBody(request);
    await mkdir(context.uploadsDir, { recursive: true });
    await writeFile(filePath, body);
    sendJson(response, { storedPath: filePath });
    return true;
  }

  return false;
};

function sanitizeUploadedFileName(fileName: string): string {
  const normalized = fileName.trim().length > 0 ? fileName.trim() : 'uploaded.bin';
  return normalized.replace(/[^\p{L}\p{N}._-]+/gu, '_');
}
