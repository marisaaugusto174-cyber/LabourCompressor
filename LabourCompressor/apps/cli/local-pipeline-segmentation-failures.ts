export type SegmentationFailureCode =
  | 'duration-rule-unsatisfied'
  | 'export-failed'
  | 'detection-result-invalid';

export function createProblemFailureMessage(
  errorCode: SegmentationFailureCode,
  error: unknown
): string {
  const category = humanizeProblemCategory(errorCode);
  const detail = error instanceof Error ? error.message : '';
  return detail.length === 0 ? category : `${category}：${detail}`;
}

function humanizeProblemCategory(errorCode: SegmentationFailureCode): string {
  if (errorCode === 'duration-rule-unsatisfied') return '无法满足 5-60s';
  if (errorCode === 'export-failed') return '导出失败';
  return '检测结果异常';
}
