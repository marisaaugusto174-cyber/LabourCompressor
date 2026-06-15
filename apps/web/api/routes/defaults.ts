import { listVideoModelProfiles } from '../../../../packages/features/tagging/domain/index.ts';
import { PROJECT_ROOT } from '../../../cli/project-paths.ts';
import { getWebPipelineDefaults } from '../../../cli/pipeline/options.ts';
import { listTaxonomyPresets } from '../../../cli/taxonomy-presets.ts';
import { sendJson, type WebRouteHandler } from '../http.ts';

export const handleDefaultsRoutes: WebRouteHandler = async ({ response, url }) => {
  if (url.pathname !== '/api/defaults') {
    return false;
  }

  sendJson(response, {
    cwd: PROJECT_ROOT,
    taxonomyPresets: listTaxonomyPresets(),
    modelProfiles: listVideoModelProfiles(),
    defaults: getWebPipelineDefaults()
  });
  return true;
};
