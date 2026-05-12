import path from 'node:path';
import { access, readFile } from 'node:fs/promises';

import { type DownloadedMediaAsset, type PlatformCredentialConfig } from '../../packages/features/download/domain/index.ts';
import { type SpreadsheetTaskRow } from '../../packages/features/spreadsheet-tasks/domain/index.ts';
import {
  STANDARDIZED_VIDEO_FILE_NAME_PATTERN,
  buildFailure,
  createFailureRowState,
  requireValue,
  type PipelineRowState
} from './local-pipeline-helpers.ts';
import {
  type RunLocalPipelineFailure,
  type RunLocalPipelineResult,
  type RunLocalPipelineItemResult
} from './pipeline-result.ts';

export async function validateLocalFileRows(input: {
  readonly localFileRows: readonly SpreadsheetTaskRow[];
  readonly afterEditDirectoryPath: string;
  readonly startedAt: string;
}): Promise<{
  readonly failures: readonly RunLocalPipelineFailure[];
  readonly resultsByRow: ReadonlyMap<number, PipelineRowState>;
}> {
  const resultsByRow = new Map<number, PipelineRowState>();
  const failures: RunLocalPipelineFailure[] = [];
  const invalidLocalFileRows = input.localFileRows.filter((row) => {
    const localFileName = row.sourceFileName;
    return (
      localFileName === undefined ||
      !STANDARDIZED_VIDEO_FILE_NAME_PATTERN.test(localFileName)
    );
  });

  const duplicateFileNameMap = new Map<string, SpreadsheetTaskRow[]>();
  for (const row of input.localFileRows) {
    const localFileName = row.sourceFileName;
    if (localFileName === undefined) {
      continue;
    }
    const key = localFileName.toLocaleLowerCase('zh-Hans-CN');
    const bucket = duplicateFileNameMap.get(key) ?? [];
    bucket.push(row);
    duplicateFileNameMap.set(key, bucket);
  }
  const duplicateRows = [...duplicateFileNameMap.values()]
    .filter((bucket) => bucket.length > 1)
    .flat();

  for (const row of invalidLocalFileRows) {
    const failure = buildFailure({
      row,
      phase: 'download',
      errorCode: 'edited-file-invalid-name',
      errorMessage: `Edited file name does not match naming rule: ${row.sourceFileName ?? 'UNKNOWN'}`,
      timestamp: input.startedAt
    });
    failures.push(failure);
    resultsByRow.set(
      row.rowNumber,
      createFailureRowState({
        row,
        archiveState: '文件名不合法',
        failure
      })
    );
  }

  for (const row of duplicateRows) {
    if (resultsByRow.has(row.rowNumber)) {
      continue;
    }
    const failure = buildFailure({
      row,
      phase: 'download',
      errorCode: 'edited-file-duplicate-name',
      errorMessage: `Duplicate edited file name detected: ${row.sourceFileName ?? 'UNKNOWN'}`,
      timestamp: input.startedAt
    });
    failures.push(failure);
    resultsByRow.set(
      row.rowNumber,
      createFailureRowState({
        row,
        archiveState: '文件名重复',
        failure
      })
    );
  }

  for (const row of input.localFileRows) {
    if (resultsByRow.has(row.rowNumber)) {
      continue;
    }

    const localFileName = row.sourceFileName;
    if (localFileName === undefined) {
      continue;
    }

    try {
      const localFilePath = resolveAfterEditFilePath({
        afterEditDirectoryPath: input.afterEditDirectoryPath,
        relativePath: row.sourceFileRelativePath ?? localFileName
      });
      await access(localFilePath);
    } catch {
      const failure = buildFailure({
        row,
        phase: 'download',
        errorCode: 'local-file-missing',
        errorMessage: `Edited file not found in AfterEdit: ${localFileName}`,
        timestamp: input.startedAt
      });
      failures.push(failure);
      resultsByRow.set(
        row.rowNumber,
        createFailureRowState({
          row,
          archiveState: '文件缺失',
          failure
        })
      );
    }
  }

  return Object.freeze({
    failures: Object.freeze(failures),
    resultsByRow
  });
}

export async function resolveLocalAfterEditAssets(input: {
  readonly localFileRows: readonly SpreadsheetTaskRow[];
  readonly afterEditDirectoryPath: string;
  readonly startedAt: string;
}): Promise<{
  readonly downloadedAssets: readonly DownloadedMediaAsset[];
  readonly failures: readonly RunLocalPipelineFailure[];
  readonly resultsByRow: ReadonlyMap<number, PipelineRowState>;
}> {
  const downloadedAssets: DownloadedMediaAsset[] = [];
  const failures: RunLocalPipelineFailure[] = [];
  const resultsByRow = new Map<number, PipelineRowState>();

  for (const row of input.localFileRows) {
    const localFileName = requireValue(
      row.sourceFileName,
      `Missing local file name for row ${row.rowNumber}.`
    );
    try {
      const localFilePath = resolveAfterEditFilePath({
        afterEditDirectoryPath: input.afterEditDirectoryPath,
        relativePath: row.sourceFileRelativePath ?? localFileName
      });
      await readFile(localFilePath);
      downloadedAssets.push(
        Object.freeze({
          mediaAssetId: `${row.taskId}::asset`,
          taskId: row.taskId,
          rowNumber: row.rowNumber,
          sourceUrl: localFileName,
          platform: 'bilibili',
          filePath: localFilePath,
          fileName: localFileName,
          downloadedAt: input.startedAt
        })
      );
    } catch (error) {
      const failure = buildFailure({
        row,
        phase: 'download',
        errorCode: 'local-file-missing',
        errorMessage:
          error instanceof Error
            ? `Edited file not found in AfterEdit: ${localFileName}`
            : 'Edited file not found in AfterEdit.',
        timestamp: input.startedAt
      });
      failures.push(failure);
      resultsByRow.set(
        row.rowNumber,
        createFailureRowState({
          row,
          archiveState: '文件缺失',
          failure
        })
      );
    }
  }

  return Object.freeze({
    downloadedAssets: Object.freeze(downloadedAssets),
    failures: Object.freeze(failures),
    resultsByRow
  });
}

function resolveAfterEditFilePath(input: {
  readonly afterEditDirectoryPath: string;
  readonly relativePath: string;
}): string {
  if (path.isAbsolute(input.relativePath)) {
    throw new Error(`AfterEdit relative path must not be absolute: ${input.relativePath}`);
  }

  const rootPath = path.resolve(input.afterEditDirectoryPath);
  const filePath = path.resolve(rootPath, input.relativePath);

  if (filePath !== rootPath && filePath.startsWith(`${rootPath}${path.sep}`)) {
    return filePath;
  }

  throw new Error(`AfterEdit relative path escapes the AfterEdit directory: ${input.relativePath}`);
}

export function applyManualEditGateStates(input: {
  readonly downloadedAssets: readonly DownloadedMediaAsset[];
  readonly rowByTaskId: ReadonlyMap<string, SpreadsheetTaskRow>;
  readonly resultsByRow: Map<number, PipelineRowState>;
}): void {
  for (const asset of input.downloadedAssets) {
    const row = input.rowByTaskId.get(asset.taskId);

    if (row === undefined) {
      continue;
    }

    input.resultsByRow.set(row.rowNumber, {
      rowNumber: row.rowNumber,
      url: row.url,
      collector: row.values['采集人'] ?? '',
      archiveState: '已下载待剪辑',
      levelValues: Object.freeze({
        一级标签: '',
        二级标签: '',
        三级标签: '',
        四级标签: ''
      }),
      archivePath: '',
      archiveFileName: '',
      acceptedPaths: Object.freeze([]),
      selectedContentTopicPath: undefined
    });
  }
}

export function applyDownloadFailureStates(input: {
  readonly rows: readonly SpreadsheetTaskRow[];
  readonly downloadTasks: readonly {
    readonly id: string;
    readonly status: string;
    readonly errorCode?: string;
    readonly errorMessage?: string;
    readonly updatedAt?: string;
  }[];
  readonly startedAt: string;
  readonly failures: RunLocalPipelineFailure[];
  readonly resultsByRow: Map<number, PipelineRowState>;
}): void {
  for (const row of input.rows) {
    const failedTask = input.downloadTasks.find(
      (task) => task.id === row.taskId && task.status === 'failed'
    );

    if (failedTask === undefined) {
      continue;
    }

    const failure = buildFailure({
      row,
      phase: 'download',
      errorCode: failedTask.errorCode ?? 'download-failed',
      errorMessage: humanizeDownloadFailure(
        failedTask.errorCode ?? 'download-failed',
        failedTask.errorMessage ?? 'Download failed.'
      ),
      timestamp: failedTask.updatedAt || input.startedAt
    });
    input.failures.push(failure);
    input.resultsByRow.set(
      row.rowNumber,
      createFailureRowState({
        row,
        archiveState: '下载失败',
        failure
      })
    );
  }
}

export function humanizeDownloadFailure(
  errorCode: string,
  rawMessage: string
): string {
  switch (errorCode) {
    case 'missing-credentials':
      return '下载失败：当前平台需要登录态或更高权限的请求上下文。请配置对应平台的 cookies。';
    case 'needs-fresh-cookies':
      return '下载失败：当前平台的 cookies 已失效或不够新。请重新导出该平台的 cookies.txt。';
    case 'cookies-expired':
      return '下载失败：当前平台的 cookies 已过期。请更新凭证后重试。';
    case 'blocked-by-bilibili-412':
      return '下载失败：Bilibili 返回 412 风控。请检查 cookies 是否可用，或稍后重试。';
    case 'platform-rate-limited':
      return '下载失败：平台触发频率限制。请稍后重试。';
    case 'rename-failed':
      return '下载失败：下载器在落盘重命名时失败，请检查下载目录权限或同名文件冲突。';
    case 'output-not-detected':
      return '下载失败：下载器运行结束，但程序未识别到稳定产物。';
    default:
      return rawMessage;
  }
}

export async function loadPlatformCredentialConfig(
  filePath: string | undefined
): Promise<PlatformCredentialConfig | undefined> {
  if (filePath === undefined || filePath.trim().length === 0) {
    return undefined;
  }

  try {
    const { parsePlatformCredentialConfig } = await import('../../packages/features/download/domain/index.ts');
    return parsePlatformCredentialConfig(
      JSON.parse(await readFile(filePath, 'utf8'))
    );
  } catch {
    return undefined;
  }
}

export function isDownloadAlreadySatisfied(row: SpreadsheetTaskRow): boolean {
  const archiveState = (row.values['归档状态'] ?? '').trim();
  return (
    archiveState === '已归档' ||
    archiveState === '已下载未归档' ||
    archiveState === '已下载待剪辑' ||
    archiveState === '已跳过：视频过短' ||
    archiveState === '自动分割完成' ||
    archiveState === '自动分割完成，含问题片段' ||
    archiveState === '自动分割待处理'
  );
}

export function toResultItem(state: PipelineRowState): RunLocalPipelineItemResult {
  return Object.freeze({
    rowNumber: state.rowNumber,
    url: state.url,
    collector: state.collector,
    archiveState: state.archiveState,
    levelValues: state.levelValues,
    archivePath: state.archivePath,
    archiveFileName: state.archiveFileName,
    selectedContentTopicPath: state.selectedContentTopicPath,
    acceptedPaths: state.acceptedPaths,
    timings: state.timings,
    failure: state.failure
  });
}

export function finalizePipelineResult(input: {
  readonly workflowSessionId: string;
  readonly startedAt: string;
  readonly totalRows: number;
  readonly failures: readonly RunLocalPipelineFailure[];
  readonly resultsByRow: ReadonlyMap<number, PipelineRowState>;
  readonly forceSucceededRows?: number;
  readonly currentRunSpreadsheetPath?: string;
}): RunLocalPipelineResult {
  const completedAt = new Date().toISOString();
  const results = [...input.resultsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);

  return Object.freeze({
    workflowSessionId: input.workflowSessionId,
    startedAt: input.startedAt,
    completedAt,
    totalRows: input.totalRows,
    succeededRows:
      input.forceSucceededRows ??
      results.filter((item) => item.failure === undefined).length,
    failedRows: results.filter((item) => item.failure !== undefined).length,
    results: Object.freeze(results.map(toResultItem)),
    failures: Object.freeze(input.failures),
    currentRunSpreadsheetPath: input.currentRunSpreadsheetPath
  });
}
