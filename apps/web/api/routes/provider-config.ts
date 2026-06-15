import {
  getSelectedProviderConfigSummary,
  loadProviderConfigSummary,
  probeSelectedProvider,
  saveSelectedProviderApiKey
} from '../../runtime-support.ts';
import {
  readJsonBody,
  readString,
  requireBodyString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleProviderConfigRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'GET' && url.pathname === '/api/providers') {
    const providerConfigPath =
      url.searchParams.get('providerConfigPath') ?? context.defaultProviderConfig;
    sendJson(response, await loadProviderConfigSummary(providerConfigPath));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/providers/probe') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await probeSelectedProvider({
        providerConfigPath: body.providerConfigPath ?? context.defaultProviderConfig,
        selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash'
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/provider-config/summary') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await getSelectedProviderConfigSummary({
        providerConfigPath: readString(body.providerConfigPath) || context.defaultProviderConfig,
        selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash'
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/provider-config/save-api-key') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await saveSelectedProviderApiKey({
        providerConfigPath: readString(body.providerConfigPath) || context.defaultProviderConfig,
        selectedModelProfileId: readString(body.selectedModelProfileId) || 'qwen-3.6-flash',
        apiKey: requireBodyString(body, 'apiKey')
      })
    );
    return true;
  }

  return false;
};
