export interface ContentTopicArchiveDecision {
  readonly selectedPath?: string;
  readonly levelValues: Readonly<{
    '一级标签': string;
    '二级标签': string;
    '三级标签': string;
    '四级标签': string;
  }>;
}

export interface ArchivePathSelectionInput {
  readonly acceptedPaths: readonly string[];
  readonly archiveDimension?: string;
}

export function buildStructuredLevelValues(
  acceptedPaths: readonly string[],
  archiveDimension = '内容题材'
): Readonly<{
  '一级标签': string;
  '二级标签': string;
  '三级标签': string;
  '四级标签': string;
}> {
  const contentTopicDecision = selectUniqueArchivePath({
    acceptedPaths,
    archiveDimension
  });
  const selectedContentTopicPath = contentTopicDecision.selectedPath;
  const includedPaths = acceptedPaths
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (!value.startsWith(`${archiveDimension} > `)) {
        return true;
      }

      return value === selectedContentTopicPath;
    });

  const levelMap = new Map<number, string[]>();

  for (const pathValue of includedPaths) {
    const segments = pathValue.split(' > ');
    const root = segments[0] ?? '';

    for (let index = 1; index < segments.length; index += 1) {
      const label = segments[index]?.trim() ?? '';

      if (label.length === 0) {
        continue;
      }

      const formatted = `${root}: ${label}`;
      const values = levelMap.get(index) ?? [];

      if (!values.includes(formatted)) {
        values.push(formatted);
      }

      levelMap.set(index, values);
    }
  }

  return Object.freeze({
    '一级标签': joinLevelValues(levelMap.get(1)),
    '二级标签': joinLevelValues(levelMap.get(2)),
    '三级标签': joinLevelValues(levelMap.get(3)),
    '四级标签': joinLevelValues(levelMap.get(4))
  });
}

export function selectUniqueContentTopicPath(
  acceptedPaths: readonly string[]
): ContentTopicArchiveDecision {
  return selectUniqueArchivePath({
    acceptedPaths,
    archiveDimension: '内容题材'
  });
}

export function selectUniqueArchivePath(
  input: ArchivePathSelectionInput
): ContentTopicArchiveDecision {
  const archiveDimension = input.archiveDimension ?? '内容题材';
  const contentTopicPaths = input.acceptedPaths
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${archiveDimension} > `));

  if (contentTopicPaths.length === 0) {
    return Object.freeze({
      selectedPath: undefined,
      levelValues: emptyLevelValues()
    });
  }

  const ranked = [...contentTopicPaths]
    .map((pathValue, index) => ({
      pathValue,
      index,
      depth: pathValue.split(' > ').length
    }))
    .sort((left, right) => {
      if (right.depth !== left.depth) {
        return right.depth - left.depth;
      }

      return left.index - right.index;
    });

  const selectedPath = ranked[0]!.pathValue;
  const segments = selectedPath.split(' > ').slice(1);

  return Object.freeze({
    selectedPath,
    levelValues: Object.freeze({
      '一级标签': segments[0] ?? '',
      '二级标签': segments[1] ?? '',
      '三级标签': segments[2] ?? '',
      '四级标签': segments[3] ?? ''
    })
  });
}

export function buildContentTopicArchiveRoot(
  archiveRoot: string
): string {
  return `${archiveRoot.replace(/[\\/]+$/u, '')}/视频数据归档库`;
}

function emptyLevelValues(): Readonly<{
  '一级标签': string;
  '二级标签': string;
  '三级标签': string;
  '四级标签': string;
}> {
  return Object.freeze({
    '一级标签': '',
    '二级标签': '',
    '三级标签': '',
    '四级标签': ''
  });
}

function joinLevelValues(values: readonly string[] | undefined): string {
  return values === undefined ? '' : values.join(' | ');
}
