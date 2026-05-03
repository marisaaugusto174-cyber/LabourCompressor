export interface RunLocalPipelineFailure {
  readonly rowNumber: number;
  readonly url: string;
  readonly phase: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly timestamp: string;
}

export interface RunLocalPipelineItemResult {
  readonly rowNumber: number;
  readonly url: string;
  readonly collector: string;
  readonly archiveState: string;
  readonly levelValues: Readonly<Record<string, string>>;
  readonly archivePath: string;
  readonly archiveFileName: string;
  readonly selectedContentTopicPath?: string;
  readonly acceptedPaths: readonly string[];
  readonly failure?: RunLocalPipelineFailure;
}

export interface RunLocalPipelineResult {
  readonly workflowSessionId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly totalRows: number;
  readonly succeededRows: number;
  readonly failedRows: number;
  readonly results: readonly RunLocalPipelineItemResult[];
  readonly failures: readonly RunLocalPipelineFailure[];
}
