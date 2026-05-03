export {
  createTaxonomyChangeSet,
  createTaxonomyNode,
  createTaxonomyPath,
  createTaxonomyVersion,
  hasTaxonomyChanges,
  isDirectChildNode
} from './taxonomy-domain.ts';
export {
  lookupTaxonomyPath,
  normalizeTaxonomyPathInput,
  validateTaxonomyPath,
  validateTaxonomyPaths
} from './taxonomy-legality.ts';
export { diffTaxonomyTrees } from './taxonomy-diff.ts';
export {
  createTaxonomyPathMigrations,
  planIndexMigrations
} from './taxonomy-migration.ts';
export { parseTaxonomyMarkdown } from './taxonomy-markdown-parser.ts';

export type {
  ParsedTaxonomyTree
} from './taxonomy-markdown-parser.ts';

export type {
  TaxonomyChangeSet,
  TaxonomyMovedNode,
  TaxonomyNode,
  TaxonomyNodeId,
  TaxonomyPath,
  TaxonomyRenamedNode,
  TaxonomyVersion,
  TaxonomyVersionId
} from './taxonomy-domain.ts';
export type {
  TaxonomyPathLookup,
  TaxonomyPathValidationResult
} from './taxonomy-legality.ts';
export type {
  ArchiveMigrationPlan,
  IndexMigrationPlan,
  TaxonomyPathMigration
} from './taxonomy-migration.ts';
