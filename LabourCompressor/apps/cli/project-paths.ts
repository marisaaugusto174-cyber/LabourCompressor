import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

export function projectPath(...segments: readonly string[]): string {
  return path.join(PROJECT_ROOT, ...segments);
}

export const DEFAULT_PROVIDER_CONFIG_PATH = projectPath(
  'config/model-providers/providers.local.json'
);

export const DEFAULT_MASTER_SPREADSHEET_PATH = projectPath('视频数据采集总表.xlsx');

export const DEFAULT_VIDEO_CACHE_DIRECTORY = projectPath('.cache/video-tagging');
