import {
  applyReviewQueueDecision,
  scanReviewQueueDirectory
} from '../../review-queue.ts';
import {
  readJsonBody,
  readString,
  requireBodyString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleReviewQueueRoutes: WebRouteHandler = async ({ request, response, url }) => {
  if (request.method === 'POST' && url.pathname === '/api/review-queue/scan') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await scanReviewQueueDirectory({
        directoryPath: requireBodyString(body, 'directoryPath')
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/review-queue/decision') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await applyReviewQueueDecision({
        directoryPath: requireBodyString(body, 'directoryPath'),
        reviewItemId: requireBodyString(body, 'reviewItemId'),
        decision: requireReviewQueueDecision(body.decision),
        afterEditDirectoryPath: readString(body.afterEditDirectoryPath) || undefined
      })
    );
    return true;
  }

  return false;
};

function requireReviewQueueDecision(value: unknown): 'discard' | 'keep-afteredit' | 'keep-problem' | 'manual-retry' {
  const decision = readString(value);

  if (
    decision === 'discard' ||
    decision === 'keep-afteredit' ||
    decision === 'keep-problem' ||
    decision === 'manual-retry'
  ) {
    return decision;
  }

  throw new Error(`Unsupported review queue decision: ${decision}`);
}
