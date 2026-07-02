import { access } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';

import { PROJECT_ROOT } from '../cli/project-paths.ts';

export interface TagVisionLaunchResult {
  readonly status: 'started';
  readonly url: string;
}

export interface TagVisionLauncher {
  launch(): Promise<TagVisionLaunchResult>;
}

export interface CreateTagVisionLauncherOptions {
  readonly launcherPath?: string;
  readonly tagVisionUrl?: string;
  readonly spawnProcess?: typeof spawn;
}

const DEFAULT_TAGVISION_HOST = '127.0.0.1';
const DEFAULT_TAGVISION_PORT = '4312';
const DEFAULT_TAGVISION_URL = `http://${DEFAULT_TAGVISION_HOST}:${DEFAULT_TAGVISION_PORT}/review.html`;

export function createTagVisionLauncher(options: CreateTagVisionLauncherOptions = {}): TagVisionLauncher {
  const launcherPath = options.launcherPath
    ?? process.env.TAGVISION_LAUNCHER_PATH
    ?? path.resolve(PROJECT_ROOT, '..', 'TagVision', 'Start TagVision macOS.command');
  const tagVisionUrl = options.tagVisionUrl ?? process.env.TAGVISION_URL ?? DEFAULT_TAGVISION_URL;
  const spawnProcess = options.spawnProcess ?? spawn;

  return {
    async launch() {
      await access(launcherPath);
      const child = spawnProcess('/bin/bash', [launcherPath], buildSpawnOptions(launcherPath));
      child.unref();
      return {
        status: 'started',
        url: tagVisionUrl
      };
    }
  };
}

function buildSpawnOptions(launcherPath: string): SpawnOptions {
  return {
    cwd: path.dirname(launcherPath),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      TAGVISION_WEB_HOST: process.env.TAGVISION_WEB_HOST ?? DEFAULT_TAGVISION_HOST,
      TAGVISION_WEB_PORT: process.env.TAGVISION_WEB_PORT ?? DEFAULT_TAGVISION_PORT
    }
  };
}
