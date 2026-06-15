import { sendJson, type WebRouteHandler, type WebRouteInput } from '../http.ts';
import { handleCacheRoutes } from './cache.ts';
import { handleDefaultsRoutes } from './defaults.ts';
import { handleDownloadProbeRoutes } from './download-probe.ts';
import { handleLocalDialogRoutes } from './local-dialogs.ts';
import { handlePipelineRoutes } from './pipeline.ts';
import { handlePlatformCredentialRoutes } from './platform-credentials.ts';
import { handleProviderConfigRoutes } from './provider-config.ts';
import { handleStaticRoutes } from './static.ts';
import { handleTagReviewRoutes } from './tag-review.ts';
import { handleTaskRoutes } from './tasks.ts';

const ROUTES: readonly WebRouteHandler[] = Object.freeze([
  handleStaticRoutes,
  handleDefaultsRoutes,
  handleTaskRoutes,
  handlePipelineRoutes,
  handleLocalDialogRoutes,
  handleCacheRoutes,
  handleProviderConfigRoutes,
  handlePlatformCredentialRoutes,
  handleDownloadProbeRoutes,
  handleTagReviewRoutes
]);

export async function dispatchWebRoute(input: WebRouteInput): Promise<void> {
  for (const route of ROUTES) {
    if (await route(input)) {
      return;
    }
  }

  sendJson(input.response, { error: 'Not found.' }, 404);
}
