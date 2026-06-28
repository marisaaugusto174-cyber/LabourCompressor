import { type ParsedTaxonomyTree } from './taxonomy-markdown-parser.ts';

export interface TaxonomyPathLookup {
  readonly input: string;
  readonly normalizedPath: string;
  readonly exists: boolean;
  readonly nodeId?: string | undefined;
}

export interface TaxonomyPathValidationResult {
  readonly input: string;
  readonly normalizedPath: string;
  readonly isLegal: boolean;
  readonly reason?:
    | 'empty-path'
    | 'unknown-path'
    | 'duplicate-input'
    | 'contains-empty-segment';
  readonly nodeId?: string | undefined;
}

export function normalizeTaxonomyPathInput(path: string): string {
  const normalizedSegments = path
    .split('>')
    .map((segment) => segment.trim());

  if (normalizedSegments.length === 0) {
    return '';
  }

  if (normalizedSegments.some((segment) => segment.length === 0)) {
    return '';
  }

  return normalizedSegments.join(' > ');
}

export function lookupTaxonomyPath(
  tree: ParsedTaxonomyTree,
  path: string
): TaxonomyPathLookup {
  const normalizedPath = normalizeTaxonomyPathInput(path);
  const nodeId = normalizedPath.length
    ? tree.nodeIdsByPath[normalizedPath]
    : undefined;

  return Object.freeze({
    input: path,
    normalizedPath,
    exists: nodeId !== undefined,
    nodeId
  });
}

export function validateTaxonomyPath(
  tree: ParsedTaxonomyTree,
  path: string
): TaxonomyPathValidationResult {
  if (path.trim().length === 0) {
    return Object.freeze({
      input: path,
      normalizedPath: '',
      isLegal: false,
      reason: 'empty-path'
    });
  }

  const normalizedPath = normalizeTaxonomyPathInput(path);

  if (normalizedPath.length === 0) {
    return Object.freeze({
      input: path,
      normalizedPath,
      isLegal: false,
      reason: 'contains-empty-segment'
    });
  }

  const nodeId = tree.nodeIdsByPath[normalizedPath];

  if (nodeId === undefined) {
    return Object.freeze({
      input: path,
      normalizedPath,
      isLegal: false,
      reason: 'unknown-path'
    });
  }

  return Object.freeze({
    input: path,
    normalizedPath,
    isLegal: true,
    nodeId
  });
}

export function validateTaxonomyPaths(
  tree: ParsedTaxonomyTree,
  paths: readonly string[]
): readonly TaxonomyPathValidationResult[] {
  const seenPaths = new Set<string>();

  return Object.freeze(
    paths.map((path) => {
      const validation = validateTaxonomyPath(tree, path);

      if (!validation.isLegal) {
        return validation;
      }

      if (seenPaths.has(validation.normalizedPath)) {
        return Object.freeze({
          input: path,
          normalizedPath: validation.normalizedPath,
          isLegal: false,
          reason: 'duplicate-input'
        });
      }

      seenPaths.add(validation.normalizedPath);

      return validation;
    })
  );
}
