import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ResolveSceneDetectBinaryPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly exists?: (filePath: string) => boolean;
}

export function resolveSceneDetectBinaryPath(
  projectRoot: string,
  options: ResolveSceneDetectBinaryPathOptions = {}
): string {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const localBinaryPath =
    platform === 'win32'
      ? resolveFirstExistingPath(
          [
            path.join(projectRoot, '.tools', 'scenedetect-venv', 'Scripts', 'scenedetect.exe'),
            path.join(projectRoot, '.tools', 'scenedetect-venv', 'Scripts', 'scenedetect.cmd'),
            path.join(projectRoot, '.tools', 'bin', 'scenedetect.exe'),
            path.join(projectRoot, '.tools', 'bin', 'scenedetect.cmd'),
            path.join(projectRoot, '.tools', 'bin', 'scenedetect.bat')
          ],
          exists
        )
      : path.join(projectRoot, '.tools', 'bin', 'scenedetect');

  return localBinaryPath !== undefined && exists(localBinaryPath)
    ? localBinaryPath
    : 'scenedetect';
}

function resolveFirstExistingPath(
  candidatePaths: readonly string[],
  exists: (filePath: string) => boolean
): string | undefined {
  return candidatePaths.find((candidatePath) => exists(candidatePath));
}
