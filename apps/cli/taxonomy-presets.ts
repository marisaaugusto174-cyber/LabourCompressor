export interface TaxonomyPresetDefinition {
  readonly id: 'business' | 'v0';
  readonly label: string;
  readonly filePath: string;
  readonly description: string;
}

const TAXONOMY_PRESETS: readonly TaxonomyPresetDefinition[] = Object.freeze([
  Object.freeze({
    id: 'business',
    label: '业务标签库（V0）',
    filePath:
      '/Users/tianyi/Desktop/codex/jobtask/config/taxonomies/video-data-collection-taxonomy-v0-260415.md',
    description: '当前项目默认使用的 V0 视频数据采集分层标签库。'
  }),
  Object.freeze({
    id: 'v0',
    label: '视频数据采集标签框架（260415）V0',
    filePath:
      '/Users/tianyi/Desktop/codex/jobtask/config/taxonomies/video-data-collection-taxonomy-v0-260415.md',
    description: '由 PDF 固化到项目内的 V0 标准标签库。'
  })
]);

export function listTaxonomyPresets(): readonly TaxonomyPresetDefinition[] {
  return TAXONOMY_PRESETS;
}

export function resolveTaxonomyInput(input: {
  readonly taxonomyPath?: string;
  readonly taxonomyPreset?: string;
}): string {
  if (input.taxonomyPath !== undefined && input.taxonomyPath.trim().length > 0) {
    return input.taxonomyPath.trim();
  }

  if (input.taxonomyPreset === undefined || input.taxonomyPreset.trim().length === 0) {
    throw new Error('Missing required CLI argument: --taxonomy or --taxonomy-preset');
  }

  const preset = TAXONOMY_PRESETS.find((item) => item.id === input.taxonomyPreset.trim());

  if (preset === undefined) {
    throw new Error(
      `Unknown taxonomy preset: "${input.taxonomyPreset}". Supported presets: ${TAXONOMY_PRESETS.map((item) => item.id).join(', ')}`
    );
  }

  return preset.filePath;
}
