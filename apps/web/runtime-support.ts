import { type RunLocalPipelineResult } from '../cli/pipeline-result.ts';

export type {
  LocalDialogResult,
  PlatformCredentialSummaryEntry,
  RuntimeCheckResult,
  VideoCacheEntry,
  VideoCacheStats
} from './runtime-support-types.ts';

export { runPipelinePreflight } from './runtime-support-checks.ts';
export {
  buildPostEditRecordSheet,
  chooseLocalPath,
  ensureDefaultMasterSpreadsheet
} from './runtime-support-local.ts';
export {
  ensureFirstRunLocalState
} from './runtime-support-first-run.ts';
export {
  clearVideoCache,
  getVideoCacheStats
} from './runtime-support-cache.ts';
export {
  getSelectedProviderConfigSummary,
  loadProviderConfigSummary,
  probeSelectedProvider,
  saveSelectedProviderApiKey
} from './runtime-support-provider.ts';
export {
  loadPlatformCredentialSummary,
  probePlatformDownload,
  savePlatformCredentialConfig
} from './runtime-support-platform.ts';

export function exportFailuresAsCsv(result: RunLocalPipelineResult): string {
  const rows = [
    ['row_number', 'url', 'phase', 'error_code', 'error_message', 'timestamp'],
    ...result.failures.map((failure) => [
      String(failure.rowNumber),
      failure.url,
      failure.phase,
      failure.errorCode,
      failure.errorMessage,
      failure.timestamp
    ])
  ];

  return `${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')}\n`;
}

function escapeCsvCell(value: string): string {
  if (/[,"\n]/u.test(value)) {
    return `"${value.replace(/"/gu, '""')}"`;
  }

  return value;
}
