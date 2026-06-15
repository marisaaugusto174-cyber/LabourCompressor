export type TaxonomyNodeId = string;
export type TaxonomyVersionId = string;

export interface TaxonomyPath {
  readonly segments: readonly string[];
  readonly value: string;
}

export interface TaxonomyNode {
  readonly id: TaxonomyNodeId;
  readonly label: string;
  readonly depth: number;
  readonly path: TaxonomyPath;
  readonly parentId?: TaxonomyNodeId;
  readonly childIds: readonly TaxonomyNodeId[];
}

export interface TaxonomyMovedNode {
  readonly nodeId: TaxonomyNodeId;
  readonly fromPath: TaxonomyPath;
  readonly toPath: TaxonomyPath;
}

export interface TaxonomyRenamedNode {
  readonly nodeId: TaxonomyNodeId;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly path: TaxonomyPath;
}

export interface TaxonomyChangeSet {
  readonly addedPaths: readonly TaxonomyPath[];
  readonly removedPaths: readonly TaxonomyPath[];
  readonly movedNodes: readonly TaxonomyMovedNode[];
  readonly renamedNodes: readonly TaxonomyRenamedNode[];
  readonly totalChanges: number;
}

export interface TaxonomyVersion {
  readonly id: TaxonomyVersionId;
  readonly versionLabel: string;
  readonly sourceDocumentPath: string;
  readonly checksum: string;
  readonly createdAt: string;
  readonly rootNodeIds: readonly TaxonomyNodeId[];
  readonly changeSet: TaxonomyChangeSet;
  readonly previousVersionId?: TaxonomyVersionId;
}

interface CreateTaxonomyPathInput {
  readonly segments: readonly string[];
}

interface CreateTaxonomyNodeInput {
  readonly id: TaxonomyNodeId;
  readonly label: string;
  readonly depth: number;
  readonly path: TaxonomyPath;
  readonly parentId?: TaxonomyNodeId;
  readonly childIds?: readonly TaxonomyNodeId[];
}

interface CreateTaxonomyChangeSetInput {
  readonly addedPaths?: readonly TaxonomyPath[];
  readonly removedPaths?: readonly TaxonomyPath[];
  readonly movedNodes?: readonly TaxonomyMovedNode[];
  readonly renamedNodes?: readonly TaxonomyRenamedNode[];
}

interface CreateTaxonomyVersionInput {
  readonly id: TaxonomyVersionId;
  readonly versionLabel: string;
  readonly sourceDocumentPath: string;
  readonly checksum: string;
  readonly createdAt: string;
  readonly rootNodeIds: readonly TaxonomyNodeId[];
  readonly changeSet?: TaxonomyChangeSet;
  readonly previousVersionId?: TaxonomyVersionId;
}

export function createTaxonomyPath(
  input: CreateTaxonomyPathInput
): TaxonomyPath {
  const segments = input.segments.map(normalizeSegment);

  if (segments.length === 0) {
    throw new Error('Taxonomy path must contain at least one segment.');
  }

  return Object.freeze({
    segments: Object.freeze(segments),
    value: segments.join(' > ')
  });
}

export function createTaxonomyNode(
  input: CreateTaxonomyNodeInput
): TaxonomyNode {
  assertNonEmptyValue(input.id, 'Taxonomy node id');
  assertNonEmptyValue(input.label, 'Taxonomy node label');

  if (input.depth !== input.path.segments.length - 1) {
    throw new Error(
      'Taxonomy node depth must match the number of path segments.'
    );
  }

  if (input.depth === 0 && input.parentId !== undefined) {
    throw new Error('Root taxonomy node must not define a parent id.');
  }

  if (input.depth > 0 && input.parentId === undefined) {
    throw new Error('Non-root taxonomy node must define a parent id.');
  }

  return Object.freeze({
    id: input.id.trim(),
    label: input.label.trim(),
    depth: input.depth,
    path: input.path,
    parentId: input.parentId,
    childIds: Object.freeze([...(input.childIds ?? [])])
  });
}

export function createTaxonomyChangeSet(
  input: CreateTaxonomyChangeSetInput = {}
): TaxonomyChangeSet {
  const addedPaths = Object.freeze([...(input.addedPaths ?? [])]);
  const removedPaths = Object.freeze([...(input.removedPaths ?? [])]);
  const movedNodes = Object.freeze([...(input.movedNodes ?? [])]);
  const renamedNodes = Object.freeze([...(input.renamedNodes ?? [])]);

  return Object.freeze({
    addedPaths,
    removedPaths,
    movedNodes,
    renamedNodes,
    totalChanges:
      addedPaths.length +
      removedPaths.length +
      movedNodes.length +
      renamedNodes.length
  });
}

export function createTaxonomyVersion(
  input: CreateTaxonomyVersionInput
): TaxonomyVersion {
  assertNonEmptyValue(input.id, 'Taxonomy version id');
  assertNonEmptyValue(input.versionLabel, 'Taxonomy version label');
  assertNonEmptyValue(
    input.sourceDocumentPath,
    'Taxonomy source document path'
  );
  assertNonEmptyValue(input.checksum, 'Taxonomy checksum');
  assertNonEmptyValue(input.createdAt, 'Taxonomy createdAt');

  if (input.rootNodeIds.length === 0) {
    throw new Error('Taxonomy version must contain at least one root node.');
  }

  return Object.freeze({
    id: input.id.trim(),
    versionLabel: input.versionLabel.trim(),
    sourceDocumentPath: input.sourceDocumentPath.trim(),
    checksum: input.checksum.trim(),
    createdAt: input.createdAt.trim(),
    rootNodeIds: Object.freeze([...input.rootNodeIds]),
    changeSet: input.changeSet ?? createTaxonomyChangeSet(),
    previousVersionId: input.previousVersionId
  });
}

export function hasTaxonomyChanges(changeSet: TaxonomyChangeSet): boolean {
  return changeSet.totalChanges > 0;
}

export function isDirectChildNode(
  parentNode: TaxonomyNode,
  childNode: TaxonomyNode
): boolean {
  return (
    childNode.parentId === parentNode.id &&
    childNode.depth === parentNode.depth + 1
  );
}

function normalizeSegment(segment: string): string {
  const normalizedSegment = segment.trim();

  if (normalizedSegment.length === 0) {
    throw new Error('Taxonomy path segment must not be empty.');
  }

  return normalizedSegment;
}

function assertNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}
