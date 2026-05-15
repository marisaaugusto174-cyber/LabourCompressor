import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ResolveLocalMediaBinaryPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly projectRoot?: string;
  readonly exists?: (filePath: string) => boolean;
}

export function resolveFfmpegBinaryPath(
  binaryPath?: string,
  options: ResolveLocalMediaBinaryPathOptions = {}
): string {
  return resolveLocalMediaBinaryPath('ffmpeg', binaryPath, options);
}

export function resolveFfprobeBinaryPath(
  binaryPath?: string,
  options: ResolveLocalMediaBinaryPathOptions = {}
): string {
  return resolveLocalMediaBinaryPath('ffprobe', binaryPath, options);
}

export async function validateLocalBinary(
  binaryPath: string,
  args: readonly string[]
): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, args);
    return true;
  } catch {
    return false;
  }
}

function resolveLocalMediaBinaryPath(
  commandName: string,
  binaryPath: string | undefined,
  options: ResolveLocalMediaBinaryPathOptions
): string {
  if (binaryPath !== undefined && binaryPath.trim().length > 0) {
    return binaryPath;
  }

  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const projectRoot = options.projectRoot ?? process.cwd();

  if (platform === 'win32') {
    return resolveFirstExistingPath(
      [
        path.join(projectRoot, '.tools', 'bin', `${commandName}.exe`),
        path.join(projectRoot, '.tools', 'bin', `${commandName}.cmd`),
        path.join(projectRoot, '.tools', 'bin', `${commandName}.bat`)
      ],
      exists
    ) ?? commandName;
  }

  return commandName;
}

function resolveFirstExistingPath(
  candidatePaths: readonly string[],
  exists: (filePath: string) => boolean
): string | undefined {
  return candidatePaths.find((candidatePath) => exists(candidatePath));
}
