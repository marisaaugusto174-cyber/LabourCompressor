import { serveStatic, type WebRouteHandler } from '../http.ts';

export const handleStaticRoutes: WebRouteHandler = async ({ response, url, context }) => {
  if (url.pathname === '/') {
    await serveStatic(response, context.publicDir, 'index.html', 'text/html; charset=utf-8');
    return true;
  }

  if (url.pathname === '/review.html') {
    await serveStatic(response, context.publicDir, 'review.html', 'text/html; charset=utf-8');
    return true;
  }

  if (url.pathname === '/app.js') {
    await serveStatic(response, context.publicDir, 'app.js', 'text/javascript; charset=utf-8');
    return true;
  }

  if (/^\/[a-z0-9-]+\.js$/u.test(url.pathname)) {
    await serveStatic(response, context.publicDir, url.pathname.slice(1), 'text/javascript; charset=utf-8');
    return true;
  }

  if (url.pathname === '/styles.css') {
    await serveStatic(response, context.publicDir, 'styles.css', 'text/css; charset=utf-8');
    return true;
  }

  return false;
};
