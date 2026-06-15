import { clearVideoCache, getVideoCacheStats } from '../../runtime-support.ts';
import { readJsonBody, sendJson, type WebRouteHandler } from '../http.ts';

export const handleCacheRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'GET' && url.pathname === '/api/cache') {
    sendJson(response, await getVideoCacheStats(context.defaultCacheRoot));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/cache/clear') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await clearVideoCache({
        cacheRootDirectory: context.defaultCacheRoot,
        mode: body.mode === 'expired' ? 'expired' : 'all'
      })
    );
    return true;
  }

  return false;
};
