import path from 'node:path';

import { PROJECT_ROOT } from '../../../cli/project-paths.ts';
import { probePlatformDownload } from '../../runtime-support.ts';
import { readJsonBody, readString, sendJson, type WebRouteHandler } from '../http.ts';

export const handleDownloadProbeRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method !== 'POST' || url.pathname !== '/api/download/probe') {
    return false;
  }

  const body = await readJsonBody(request);
  sendJson(
    response,
    await probePlatformDownload({
      url: body.url,
      outputDirectory: body.outputDirectory ?? path.join(PROJECT_ROOT, '.runtime-probe'),
      ytDlpBinary: body.ytDlpBinary,
      cookiesFilePath: body.cookiesFilePath,
      cookiesFromBrowser: body.cookiesFromBrowser,
      platformCredentialConfigPath:
        readString(body.platformCredentialConfigPath) ||
        context.defaultPlatformCredentialConfig
    })
  );
  return true;
};
