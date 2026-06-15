import { type SupportedPlatform } from '../../../../packages/features/download/domain/index.ts';
import {
  loadPlatformCredentialSummary,
  savePlatformCredentialConfig
} from '../../runtime-support.ts';
import {
  readJsonBody,
  readString,
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

  return false;
};

function requireSupportedPlatform(input: unknown): SupportedPlatform {
  const value = readString(input);
  if (
    value === 'bilibili' ||
    value === 'youtube' ||
    value === 'douyin' ||
    value === 'tiktok'
  ) {
    return value;
  }

  throw new Error(`Unsupported platform value: "${String(input)}"`);
}
