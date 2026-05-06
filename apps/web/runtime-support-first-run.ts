import { constants } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface FirstRunLocalStateInput {
  readonly providerTemplatePath: string;
  readonly providerLocalPath: string;
  readonly platformTemplatePath: string;
  readonly platformLocalPath: string;
  readonly runtimeDirectories: readonly string[];
}

export interface FirstRunLocalStateResult {
  readonly createdFiles: readonly string[];
  readonly existingFiles: readonly string[];
  readonly ensuredDirectories: readonly string[];
}

export async function ensureFirstRunLocalState(
  input: FirstRunLocalStateInput
): Promise<FirstRunLocalStateResult> {
  const providerResult = await ensureLocalFileFromTemplate({
    templatePath: input.providerTemplatePath,
    localPath: input.providerLocalPath
  });
  const platformResult = await ensureLocalFileFromTemplate({
    templatePath: input.platformTemplatePath,
    localPath: input.platformLocalPath
  });

  for (const directory of input.runtimeDirectories) {
    await mkdir(directory, { recursive: true });
  }

  return Object.freeze({
    createdFiles: Object.freeze(
      [providerResult, platformResult]
        .filter((result) => result.created)
        .map((result) => result.localPath)
    ),
    existingFiles: Object.freeze(
      [providerResult, platformResult]
        .filter((result) => !result.created)
        .map((result) => result.localPath)
    ),
    ensuredDirectories: Object.freeze([...input.runtimeDirectories])
  });
}

async function ensureLocalFileFromTemplate(input: {
  readonly templatePath: string;
  readonly localPath: string;
}): Promise<{ readonly localPath: string; readonly created: boolean }> {
  if (await isReadableFile(input.localPath)) {
    return Object.freeze({ localPath: input.localPath, created: false });
  }

  if (!(await isReadableFile(input.templatePath))) {
    throw new Error(`Missing template file for first-run setup: ${input.templatePath}`);
  }

  await mkdir(path.dirname(input.localPath), { recursive: true });
  await copyFile(input.templatePath, input.localPath, constants.COPYFILE_EXCL);
  return Object.freeze({ localPath: input.localPath, created: true });
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
