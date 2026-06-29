import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveSceneDetectBinaryPath(projectRoot: string): string {
  const localBinaryPath = path.join(projectRoot, '.tools', 'bin', 'scenedetect');
  return existsSync(localBinaryPath) ? localBinaryPath : 'scenedetect';
}

export function resolveContinuityPythonPath(projectRoot: string): string {
  const localPythonPath = path.join(projectRoot, '.tools', 'scenedetect-venv', 'bin', 'python');
  return existsSync(localPythonPath) ? localPythonPath : 'python3';
}
