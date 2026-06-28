import { importExternalTaxonomyPreset } from '../../../cli/taxonomy-presets.ts';
import {
  readJsonBody,
  readString,
  requireBodyString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleTaxonomyPresetRoutes: WebRouteHandler = async ({ request, response, url }) => {
  if (request.method === 'POST' && url.pathname === '/api/taxonomy-presets/import') {
    const body = await readJsonBody(request);
    const preset = await importExternalTaxonomyPreset({
      sourceFilePath: requireBodyString(body, 'taxonomyFilePath'),
      label: readString(body.label) || undefined
    });

    sendJson(response, { preset });
    return true;
  }

  return false;
};
