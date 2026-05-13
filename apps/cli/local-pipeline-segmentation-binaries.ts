import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveSceneDetectBinaryPath(projectRoot: string): string {
  const localBinaryPath = path.join(projectRoot, '.tools', 'bin', 'scenedetect');
  return existsSync(localBinaryPath) ? localBinaryPath : 'scenedetect';
}
