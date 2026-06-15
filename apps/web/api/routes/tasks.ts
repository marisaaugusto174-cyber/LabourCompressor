import { type IncomingMessage, type ServerResponse } from 'node:http';

import { writePartialTaggingResultsFromSidecars } from '../../../cli/partial-tagging-writeback.ts';
import { exportFailuresAsCsv } from '../../runtime-support.ts';
import {
  isRecord,
  readString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handleTaskRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    sendJson(response, { tasks: context.taskService.listTasks() });
    return true;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/events')) {
    await handleTaskEvents(request, response, url.pathname.split('/')[3] ?? '', context);
    return true;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/failures.csv')) {
    const taskId = url.pathname.split('/')[3] ?? '';
    const task = context.taskService.getTask(taskId);

    if (task?.result === undefined) {
      sendJson(response, { error: 'Task result not found.' }, 404);
      return true;
    }

    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${taskId}-failures.csv"`
    });
    response.end(exportFailuresAsCsv(task.result));
    return true;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
    const taskId = url.pathname.split('/')[3] ?? '';
    const task = context.taskService.getTask(taskId);
    task === undefined
      ? sendJson(response, { error: 'Task not found.' }, 404)
      : sendJson(response, task);
    return true;
  }

  for (const action of ['pause', 'resume', 'stop'] as const) {
    if (request.method === 'POST' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith(`/${action}`)) {
      const taskId = url.pathname.split('/')[3] ?? '';
      const task =
        action === 'pause'
          ? context.taskService.pauseTask(taskId)
          : action === 'resume'
            ? context.taskService.resumeTask(taskId)
            : context.taskService.stopTask(taskId);
      task === undefined
        ? sendJson(response, { error: 'Task not found.' }, 404)
        : sendJson(response, task);
      return true;
    }
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/partial-writeback')) {
    const taskId = url.pathname.split('/')[3] ?? '';
    const task = context.taskService.getTask(taskId);

    if (task === undefined) {
      sendJson(response, { error: 'Task not found.' }, 404);
      return true;
    }

    sendJson(
      response,
      await writePartialTaggingResultsFromSidecars({
        options: task.options,
        selectedContentTopicByFileName: buildSelectedContentTopicByFileName(
          context.taskService.getTaskEvents(taskId)
        ),
        startedAt: new Date().toISOString()
      })
    );
    return true;
  }

  return false;
};

function buildSelectedContentTopicByFileName(
  events: readonly { readonly currentItem?: string; readonly details?: unknown }[]
): Readonly<Record<string, string>> {
  const selectedPaths: Record<string, string> = {};

  for (const event of events) {
    const fileName = readString(event.currentItem);

    if (fileName.length === 0 || !isRecord(event.details)) {
      continue;
    }

    const selectedContentTopicPath = readString(event.details.selectedContentTopicPath);

    if (selectedContentTopicPath.length > 0) {
      selectedPaths[fileName] = selectedContentTopicPath;
    }
  }

  return Object.freeze(selectedPaths);
}

async function handleTaskEvents(
  request: IncomingMessage,
  response: ServerResponse,
  taskId: string,
  context: Parameters<WebRouteHandler>[0]['context']
): Promise<void> {
  const task = context.taskService.getTask(taskId);

  if (task === undefined) {
    return sendJson(response, { error: 'Task not found.' }, 404);
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  for (const event of context.taskService.getTaskEvents(taskId)) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const unsubscribe = context.taskService.subscribe(taskId, (event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  request.on('close', () => {
    unsubscribe?.();
    response.end();
  });
}
