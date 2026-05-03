export type TaggingScopeId = string;

export type TaggingScope =
  | DownloadBatchTaggingScope
  | AssetSelectionTaggingScope
  | DirectoryTaggingScope;

export interface DownloadBatchTaggingScope {
  readonly id: TaggingScopeId;
  readonly kind: 'download-batch';
  readonly batchId: string;
  readonly assetIds: readonly string[];
}

export interface AssetSelectionTaggingScope {
  readonly id: TaggingScopeId;
  readonly kind: 'asset-selection';
  readonly assetIds: readonly string[];
}

export interface DirectoryTaggingScope {
  readonly id: TaggingScopeId;
  readonly kind: 'directory';
  readonly directoryPath: string;
  readonly assetIds?: readonly string[];
}

export function createDefaultDownloadBatchTaggingScope(input: {
  readonly id: TaggingScopeId;
  readonly batchId: string;
  readonly assetIds: readonly string[];
}): DownloadBatchTaggingScope {
  return Object.freeze({
    id: input.id.trim(),
    kind: 'download-batch',
    batchId: input.batchId.trim(),
    assetIds: normalizeUniqueIds(input.assetIds, 'Download batch assetIds')
  });
}

export function createAssetSelectionTaggingScope(input: {
  readonly id: TaggingScopeId;
  readonly assetIds: readonly string[];
}): AssetSelectionTaggingScope {
  return Object.freeze({
    id: input.id.trim(),
    kind: 'asset-selection',
    assetIds: normalizeUniqueIds(input.assetIds, 'Asset selection assetIds')
  });
}

export function createDirectoryTaggingScope(input: {
  readonly id: TaggingScopeId;
  readonly directoryPath: string;
  readonly assetIds?: readonly string[];
}): DirectoryTaggingScope {
  assertNonEmptyValue(input.directoryPath, 'Directory tagging scope path');

  return Object.freeze({
    id: input.id.trim(),
    kind: 'directory',
    directoryPath: input.directoryPath.trim(),
    assetIds:
      input.assetIds === undefined
        ? undefined
        : normalizeUniqueIds(input.assetIds, 'Directory scope assetIds')
  });
}

export function resolveScopedAssetIds(
  scope: TaggingScope,
  availableAssetIds: readonly string[]
): readonly string[] {
  const availableSet = new Set(availableAssetIds);

  if (scope.kind === 'directory' && scope.assetIds === undefined) {
    return Object.freeze([...availableAssetIds]);
  }

  const requestedIds =
    scope.kind === 'directory'
      ? scope.assetIds ?? []
      : scope.assetIds;

  return Object.freeze(
    requestedIds.filter((assetId) => availableSet.has(assetId))
  );
}

function normalizeUniqueIds(
  values: readonly string[],
  fieldName: string
): readonly string[] {
  const normalizedValues = values.map((value) => {
    assertNonEmptyValue(value, fieldName);
    return value.trim();
  });

  return Object.freeze([...new Set(normalizedValues)]);
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}
