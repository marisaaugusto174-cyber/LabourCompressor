import { writePartialTaggingResultsFromSidecars } from '../../../cli/partial-tagging-writeback.ts';
import { buildWebPipelineOptions } from '../../../cli/pipeline/options.ts';
import {
  buildPostEditRecordSheet,
  ensureDefaultMasterSpreadsheet,
  runPipelinePreflight
} from '../../runtime-support.ts';
import { importSourceMediaDirectory } from '../../source-intake.ts';
import {
  readJsonBody,
  readString,
  requireBodyString,
  sendJson,
  type WebRouteHandler
} from '../http.ts';

export const handlePipelineRoutes: WebRouteHandler = async ({ request, response, url, context }) => {
  if (request.method === 'POST' && url.pathname === '/api/preflight') {
    const uiOptions = await readJsonBody(request);
    const options = buildWebPipelineOptions(uiOptions);
    sendJson(response, {
      checks: await runPipelinePreflight(options)
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const uiOptions = await readJsonBody(request);
    const options = buildWebPipelineOptions(uiOptions);
    await ensureDefaultMasterSpreadsheet(options.masterSpreadsheetPath ?? context.defaultMasterSpreadsheet);
    const task = await context.taskService.startTask(options);
    sendJson(response, task, 201);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/partial-writeback') {
    const uiOptions = await readJsonBody(request);
    sendJson(
      response,
      await writePartialTaggingResultsFromSidecars({
        options: buildWebPipelineOptions(uiOptions),
        startedAt: new Date().toISOString()
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/post-edit-sheet') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await buildPostEditRecordSheet({
        downloadDirectory: readString(body.downloadDir) || undefined,
        videoDirectoryPath: readString(body.videoDirectoryPath) || undefined,
        afterEditDirectoryName: readString(body.afterEditDirectoryName) || 'AfterEdit',
        outputFilePath: readString(body.outputFilePath) || undefined,
        batchSampleFilePath: readString(body.batchSampleFilePath) || undefined
      })
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/source-intake/import') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await importSourceMediaDirectory({
        sourceDirectoryPath: requireBodyString(body, 'sourceDirectoryPath'),
        downloadDirectory: requireBodyString(body, 'downloadDir'),
        afterEditDirectoryName: readString(body.afterEditDirectoryName) || 'AfterEdit',
        outputFilePath: readString(body.outputFilePath) || undefined
      })
    );
    return true;
  }

  return false;
};
