export interface TagReviewScanResult {
  readonly directoryPath: string;
  readonly pairedItems: readonly TagReviewItem[];
  readonly unpairedVideos: readonly TagReviewFileEntry[];
  readonly orphanJsonFiles: readonly TagReviewFileEntry[];
  readonly invalidJsonFiles: readonly TagReviewInvalidJsonFile[];
  readonly state: TagReviewStateFile | null;
}
export interface TagReviewItem {
  readonly reviewItemId: string; readonly stem: string; readonly relativeDirectory: string;
  readonly videoFileName: string; readonly jsonFileName: string;
  readonly videoRelativePath: string; readonly jsonRelativePath: string;
  readonly tagging: TagReviewTaggingSummary; readonly reviewStatus?: string | undefined;
  readonly reviewNote?: string | undefined; readonly labelStudioTaskId?: string | number | undefined;
}
export interface TagReviewFileEntry { readonly fileName: string; readonly relativePath: string; readonly relativeDirectory: string; }
export interface TagReviewInvalidJsonFile extends TagReviewFileEntry { readonly errorMessage: string; }
export interface TagReviewTaggingSummary {
  readonly taxonomyVersion: string; readonly segmentId: string; readonly reviewRequired: boolean;
  readonly reviewReason: string; readonly tags: readonly TagReviewTagSummary[];
}
export interface TagReviewTagSummary {
  readonly dimension: string; readonly labelPath: readonly string[]; readonly selectedLevel: string;
  readonly tagRole: string; readonly entityId: string; readonly targetEntityId: string;
  readonly evidenceType: string; readonly confidenceScore?: number | undefined; readonly evidenceNote: string;
}
export interface LabelStudioImportPackage { readonly labelConfig: string; readonly tasks: readonly LabelStudioImportTask[]; readonly taskCount: number; }
export interface LabelStudioImportTask { readonly data: Readonly<Record<string, unknown>>; }
export interface TagReviewStateFile {
  readonly version: 1; readonly source: 'label-studio'; readonly syncedAt: string;
  readonly items: Readonly<Record<string, TagReviewStateItem>>;
}
export interface TagReviewStateItem {
  readonly reviewItemId: string; readonly videoRelativePath: string; readonly jsonRelativePath: string;
  readonly labelStudioTaskId?: string | number | undefined; readonly status: string; readonly note: string; readonly syncedAt: string;
}
export interface WriteTagReviewStateInput { readonly directoryPath: string; readonly syncedAt: string; readonly items: readonly TagReviewStateItem[]; }
export interface ParsedRange {
  readonly start: number; readonly end: number; readonly statusCode: 200 | 206;
  readonly contentLength: number; readonly contentRange?: string | undefined;
}
