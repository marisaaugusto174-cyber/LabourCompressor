import { sendJson, type WebRouteHandler } from '../http.ts';

export const handleTagVisionLaunchRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method !== 'POST' || url.pathname !== '/api/tagvision/launch') {
    return false;
  }

  try {
    sendJson(response, await context.tagVisionLauncher.launch());
  } catch (error) {
    sendJson(
      response,
      {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }

  return true;
};
