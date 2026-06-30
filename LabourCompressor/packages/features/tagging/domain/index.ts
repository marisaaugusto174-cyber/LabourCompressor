export {
  ManualReviewRequiredError,
  ModelFallbackFailedError,
  runModelRequestWithFallback,
  type ModelFallbackTrace
} from './model-fallback.ts';

export {
  createModelConnectionConfig,
  createModelOnboardingGuide,
  validateModelConnectionConfig
} from './model-connection.ts';
export {
  getProviderCatalogEntry,
  listProviderCatalog,
  validateProviderModelSelection
} from './model-catalog.ts';
export {
  getVideoModelProfile,
  listVideoModelProfiles
} from './video-model-profiles.ts';
export {
  buildOAuthAuthorizationUrl,
  validateOAuthAuthorizationUrl
} from './oauth-link.ts';
export {
  createAssetSelectionTaggingScope,
  createDefaultDownloadBatchTaggingScope,
  createDirectoryTaggingScope,
  resolveScopedAssetIds
} from './tagging-scope.ts';
export {
  buildContentTopicArchiveRoot,
  buildStructuredLevelValues,
  selectUniqueArchivePath,
  selectUniqueContentTopicPath
} from './content-topic-classification.ts';
export {
  runAutomaticTagging
} from './auto-tagging.ts';
export {
  buildPromptLibraryInstruction,
  parsePromptLibraryMarkdown
} from './prompt-library.ts';
export {
  buildArchivePolicyInstruction,
  buildModelInstructionText,
  generateContentTopicCandidatePaths,
  generateModelCandidatePaths,
  listDimensionLeafTaxonomyPaths,
  listContentTopicLeafTaxonomyPaths,
  listLeafTaxonomyPaths,
  parseCandidatePathsFromModelText,
  parseModelTaggingResponse
} from './real-model-tagging.ts';
export {
  parseStructuredTaggingResponse
} from './structured-tag-response.ts';
export {
  ARCHIVE_PRIMARY_TAG_ERROR_CODES,
  ArchivePrimaryTagError,
  selectArchivePathFromStructuredTags
} from './archive-path-policy.ts';
export {
  getEnabledProviderConfig,
  loadLocalProviderConfigFile,
  normalizeLocalProviderConfigMap,
  sanitizeLocalProviderConfig
} from './provider-local-config.ts';
export {
  createTagAssignment,
  createTagAssignmentFromCandidateSet,
  createTagCandidateSet,
  partitionAcceptedAndRejectedPaths
} from './tagging-records.ts';

export type {
  MediaAssetId,
  RejectedCandidateSummary,
  TagAssignment,
  TagAssignmentId,
  TagAssignmentSource,
  TagCandidateSet,
  TagCandidateSetId
} from './tagging-records.ts';
export type {
  ExtendedModelProvider,
  ModelOption,
  ProviderCatalogEntry,
  ProviderTier
} from './model-catalog.ts';
export type {
  VideoModelProfile,
  VideoModelProfileId
} from './video-model-profiles.ts';
export type {
  ModelAuthMode,
  ModelConnectionConfig,
  ModelConnectionValidationResult,
  ModelOnboardingStep,
  ModelProvider
} from './model-connection.ts';
export type {
  OAuthLinkConfig
} from './oauth-link.ts';
export type {
  PromptLibraryDocument,
  PromptLibrarySection
} from './prompt-library.ts';
export type {
  LocalProviderConfig,
  LocalProviderConfigMap,
  LocalProviderOAuthConfig
} from './provider-local-config.ts';
export type {
  GenerateModelCandidatePathsResult
} from './real-model-tagging.ts';
export type {
  StructuredTagCandidate,
  StructuredTaggingResponse
} from './structured-tag-response.ts';
export type {
  AssetSelectionTaggingScope,
  DirectoryTaggingScope,
  DownloadBatchTaggingScope,
  TaggingScope,
  TaggingScopeId
} from './tagging-scope.ts';
export type {
  AutomaticTaggingInput,
  AutomaticTaggingResult
} from './auto-tagging.ts';
export type {
  ArchivePathSelectionInput,
  ContentTopicArchiveDecision
} from './content-topic-classification.ts';
export type {
  ArchivePathPolicy,
  ArchivePrimaryTagErrorCode,
  SelectArchivePathFromStructuredTagsInput
} from './archive-path-policy.ts';
