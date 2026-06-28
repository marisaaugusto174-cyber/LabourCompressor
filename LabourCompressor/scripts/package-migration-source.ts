#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PACKAGE_NAME = 'LabourCompressor-migration-source.zip';

const INCLUDED_ROOTS = Object.freeze([
  '01_PROJECT_CHARTER.md',
  '02_AGENTS_WORKFLOW.md',
  '03_STRICT_RULES.md',
  '04_STATE_AND_DATA.md',
  '05_STEP_BY_STEP_PLAN.md',
  'CSV格式要求.md',
  'LICENSE',
  'NUMBERS格式要求.md',
  'PRD.md',
  'README.md',
  'Start LabourCompressor.command',
  'TASKLIST.md',
  'V0.2_LOCAL_TEST_MANUAL.md',
  'VideoGroup_Standard',
  'apps',
  'config',
  'docs',
  'package-lock.json',
  'package.json',
  'packages',
  'scripts',
  'tsconfig.json'
]);

const FORBIDDEN_PATH_SEGMENTS = new Set([
  '.cache',
  '.git',
  '.runtime-probe',
  '.runtime-state',
  '.runtime-uploads',
  '.tools',
  'dist',
  'node_modules',
  '视频数据下载缓存',
  '视频数据归档库'
]);

const FORBIDDEN_BASENAMES = new Set([
  '.DS_Store',
  '.web-ui.log',
  '.web-ui.pid',
  'cookies.txt',
  '视频数据采集总表.xlsx'
]);

export async function buildMigrationPackageFileList(
  projectRoot: string
): Promise<readonly string[]> {
  const files: string[] = [];

  for (const root of INCLUDED_ROOTS) {
    const absolutePath = path.join(projectRoot, root);
    const collected = await collectPackageFiles(projectRoot, absolutePath);
    files.push(...collected);
  }

  return Object.freeze([...new Set(files)].sort());
}

export function isForbiddenMigrationPackagePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split('/').filter(Boolean);
  const basename = parts.at(-1) ?? '';

  if (parts.some((part) => FORBIDDEN_PATH_SEGMENTS.has(part))) {
    return true;
  }

  if (FORBIDDEN_BASENAMES.has(basename)) {
    return true;
  }

  return (
    basename.endsWith('.local.json') ||
    basename.endsWith('.cookies.txt') ||
    basename.endsWith('.cookie') ||
    basename.endsWith('.har') ||
    basename.endsWith('.log') ||
    normalized.endsWith('.zip')
  );
}

async function collectPackageFiles(
  projectRoot: string,
  absolutePath: string
): Promise<readonly string[]> {
  const fileStat = await stat(absolutePath).catch(() => undefined);
  if (fileStat === undefined) {
    return [];
  }

  const relativePath = normalizeRelativePath(path.relative(projectRoot, absolutePath));
  if (isForbiddenMigrationPackagePath(relativePath)) {
    return [];
  }

  if (fileStat.isFile()) {
    return [relativePath];
  }

  if (!fileStat.isDirectory()) {
    return [];
  }

  const entries = await readdir(absolutePath);
  const files: string[] = [];

  for (const entry of entries) {
    files.push(...await collectPackageFiles(projectRoot, path.join(absolutePath, entry)));
  }

  return files;
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\/+/u, '');
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(
    readArg('--project-root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  );
  const outputPath = path.resolve(readArg('--output') ?? path.join(path.dirname(projectRoot), DEFAULT_PACKAGE_NAME));
  const files = await buildMigrationPackageFileList(projectRoot);

  if (readFlag('--list')) {
    process.stdout.write(`${files.join('\n')}\n`);
    return;
  }

  const zip = spawnSync('/usr/bin/zip', ['-q', '-X', outputPath, ...files], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  if (zip.status !== 0) {
    throw new Error(zip.stderr || `zip failed with status ${zip.status}`);
  }

  process.stdout.write(`Created migration source package: ${outputPath}\n`);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
