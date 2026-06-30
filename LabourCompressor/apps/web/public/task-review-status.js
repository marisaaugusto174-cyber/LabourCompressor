export function hasManualReviewResult(results) {
  return results.some((item) => item.archiveState === '待人工复查');
}

export function isPendingResultState(item) {
  return !item?.failure && !['已归档', '已跳过：视频过短', '待人工复查']
    .includes(item?.archiveState);
}
