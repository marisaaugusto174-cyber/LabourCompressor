import { type SupportedPlatform } from '../../../../packages/features/download/domain/index.ts';
import {
  importAndProbePlatformCredentialFile,
  loadPlatformCredentialSummary,
  probePlatformCredentialConnectivity,
  savePlatformCredentialConfig
} from '../../runtime-support.ts';
import {
  readJsonBody,
  readString,
  requireBodyString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handlePlatformCredentialRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'GET' && url.pathname === '/api/platform-credentials') {
    const filePath =
      url.searchParams.get('platformCredentialConfigPath') ??
      context.defaultPlatformCredentialConfig;
    sendJson(response, await loadPlatformCredentialSummary(filePath));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-credentials/save') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await savePlatformCredentialConfig({
        filePath:
          readString(body.platformCredentialConfigPath) ||
          context.defaultPlatformCredentialConfig,
        platform: requireSupportedPlatform(body.platform),
        cookiesFilePath: readString(body.cookiesFilePath) || undefined,
        cookiesFromBrowser: readString(body.cookiesFromBrowser) || undefined
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-credentials/import') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await importAndProbePlatformCredentialFile({
        filePath:
          readString(body.platformCredentialConfigPath) ||
          context.defaultPlatformCredentialConfig,
        platform: requireSupportedPlatform(body.platform),
        sourceCookiesFilePath: requireBodyString(body, 'cookiesFilePath'),
        ytDlpBinary: readString(body.ytDlpBinary) || undefined
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-credentials/test') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await probePlatformCredentialConnectivity({
        platform: requireSupportedPlatform(body.platform),
        ytDlpBinary: readString(body.ytDlpBinary) || undefined,
        cookiesFilePath: readString(body.cookiesFilePath) || undefined,
        cookiesFromBrowser: readString(body.cookiesFromBrowser) || undefined,
        sampleUrl: readString(body.sampleUrl) || undefined
      })
    );
    return true;
  }

  return false;
};

function requireSupportedPlatform(input: unknown): SupportedPlatform {
  const value = readString(input);
  if (
    value === 'bilibili' ||
    value === 'youtube' ||
    value === 'douyin' ||
    value === 'tiktok' ||
    value === 'xiaohongshu'
  ) {
    return value;
  }

  throw new Error(`Unsupported platform value: "${String(input)}"`);
}
