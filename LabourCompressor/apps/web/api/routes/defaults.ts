import { listVideoModelProfiles } from '../../../../packages/features/tagging/domain/index.ts';
import { PROJECT_ROOT } from '../../../cli/project-paths.ts';
import { getWebPipelineDefaults } from '../../../cli/pipeline/options.ts';
import { listTaxonomyPresets } from '../../../cli/taxonomy-presets.ts';
import {
  listPromptPresets,
  listSegmentationProfileDefinitions
} from '../../runtime-support.ts';
import { sendJson, type WebRouteHandler } from '../http.ts';

export const handleDefaultsRoutes: WebRouteHandler = async ({ response, url }) => {
  if (url.pathname !== '/api/defaults') {
    return false;
  }

  const taxonomyPresets = listTaxonomyPresets();

  sendJson(response, {
    cwd: PROJECT_ROOT,
    taxonomyPresets,
    promptPresets: listPromptPresets({ taxonomyPresets }),
    segmentationProfiles: await listSegmentationProfileDefinitions(),
    modelProfiles: listVideoModelProfiles(),
    defaults: getWebPipelineDefaults()
  });
  return true;
};
