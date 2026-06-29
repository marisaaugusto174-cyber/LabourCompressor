import { apiGet, apiPost } from './api-client.js';
import { escapeHtml, fieldValue, setField } from './form-state.js';

export function createAppConfiguration(input) {
  let defaultsPayload = null;
  const refs = input.refs;
  const api = Object.freeze({
    getDefaults: () => defaultsPayload,
    async loadDefaults() {
      defaultsPayload = await apiGet('/api/defaults');
      refs.providerProfile.innerHTML = defaultsPayload.modelProfiles.map(option).join('');
      renderTaxonomyPresetOptions(defaultsPayload.defaults.taxonomyPreset);
      refs.segmentationProfile.innerHTML = (defaultsPayload.segmentationProfiles ?? []).map((item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label ?? item.id)}</option>`).join('');
      const values = {
        selectedModelProfileId: defaultsPayload.defaults.selectedModelProfileId,
        masterSpreadsheetPath: defaultsPayload.defaults.masterSpreadsheetPath,
        writebackTarget: 'both', providerConfigPath: defaultsPayload.defaults.providerConfigPath,
        platformCredentialConfigPath: defaultsPayload.defaults.platformCredentialConfigPath,
        downloadDir: defaultsPayload.defaults.downloadDir, sourceMode: 'spreadsheet', downloaderMode: 'yt-dlp',
        mergeMode: 'ffmpeg', taggingMode: 'qwen', archiveRoot: defaultsPayload.defaults.archiveRoot,
        manualEditGate: String(defaultsPayload.defaults.manualEditGate), autoSegmentation: defaultsPayload.defaults.autoSegmentation,
        segmentationProfileId: defaultsPayload.defaults.segmentationProfileId,
        afterEditDirectoryName: defaultsPayload.defaults.afterEditDirectoryName,
        problemClipsDirectoryName: defaultsPayload.defaults.problemClipsDirectoryName
      };
      for (const [name, value] of Object.entries(values)) setField(name, value);
      api.setTaggingConcurrency(defaultsPayload.defaults.taggingConcurrency);
      refs.masterSpreadsheetDisplay.textContent = defaultsPayload.defaults.masterSpreadsheetPath;
      refs.downloadDirDisplay.textContent = defaultsPayload.defaults.downloadDir;
      refs.afterEditDirDisplay.textContent = `${defaultsPayload.defaults.downloadDir}/${defaultsPayload.defaults.afterEditDirectoryName}`;
      if (refs.taxonomyPresetDisplay) refs.taxonomyPresetDisplay.textContent = api.resolveTaxonomyLabel();
      api.syncPresetDefaults();
      input.afterDefaults();
    },
    async refreshReadinessSummaries() {
      await Promise.allSettled([api.refreshProviderReadiness(), refreshCredentialReadiness()]);
    },
    async refreshProviderReadiness() {
      refs.providerReadiness.textContent = '检查中';
      try {
        const payload = await apiPost('/api/provider-config/model-summary', { providerConfigPath: fieldValue('providerConfigPath') });
        const selected = payload.models?.find((model) => model.profileId === fieldValue('selectedModelProfileId'));
        refs.providerReadiness.textContent = selected?.apiKeyPresent ? '已就绪' : '未配置';
        refs.providerReadiness.className = selected?.apiKeyPresent ? 'readiness-ok' : 'readiness-warning';
      } catch { refs.providerReadiness.textContent = '检查失败'; refs.providerReadiness.className = 'readiness-warning'; }
    },
    syncPresetDefaults() {
      const selected = fieldValue('taxonomyPreset') || defaultsPayload?.defaults?.taxonomyPreset;
      setField('promptLibrary', defaultsPayload?.defaults?.promptLibraryByPreset?.[selected] ?? defaultsPayload?.defaults?.promptLibrary ?? '');
    },
    resolveTaxonomyLabel() {
      const id = fieldValue('taxonomyPreset');
      return defaultsPayload?.taxonomyPresets?.find((item) => item.id === id)?.label ?? id ?? '—';
    },
    async importTaxonomyPreset() {
      refs.preflightOutput.textContent = '请选择要导入的标签库文件...';
      const picked = await apiPost('/api/dialog/open-file', { prompt: '选择标签库文件' });
      if (picked.cancelled === true || typeof picked.path !== 'string' || picked.path.length === 0) {
        refs.preflightOutput.textContent = '已取消导入标签库。'; return;
      }
      const payload = await apiPost('/api/taxonomy-presets/import', { taxonomyFilePath: picked.path });
      defaultsPayload = await apiGet('/api/defaults');
      renderTaxonomyPresetOptions(payload.preset?.id);
      api.syncPresetDefaults();
      if (refs.taxonomyPresetDisplay) refs.taxonomyPresetDisplay.textContent = api.resolveTaxonomyLabel();
      refs.preflightOutput.textContent = `已导入标签库：${payload.preset?.label ?? payload.preset?.id ?? picked.path}`;
    },
    resolveSelectedModelLabel() {
      return defaultsPayload?.modelProfiles?.find((item) => item.id === fieldValue('selectedModelProfileId'))?.label ?? '—';
    },
    resolveSelectedModelConcurrency() {
      return defaultsPayload?.modelProfiles?.find((item) => item.id === fieldValue('selectedModelProfileId'))?.defaultTaggingConcurrency ?? defaultsPayload?.defaults?.taggingConcurrency ?? 1;
    },
    syncTaskWorkspacePaths(task) {
      const spreadsheet = task?.options?.spreadsheet;
      const downloadDir = task?.options?.downloadDir;
      if (typeof spreadsheet === 'string' && spreadsheet.length > 0) setField('spreadsheet', spreadsheet);
      if (typeof downloadDir !== 'string' || downloadDir.length === 0) return;
      setField('downloadDir', downloadDir);
      refs.downloadDirDisplay.textContent = downloadDir;
      refs.afterEditDirDisplay.textContent = `${downloadDir}/${fieldValue('afterEditDirectoryName')}`;
      refs.preflightOutput.textContent = `已创建任务工作副本与视频下载缓存：${downloadDir}`;
    },
    setTaggingConcurrency(value) { setField('taggingConcurrency', String(clamp(value))); api.updateTaggingConcurrencyLabel(); },
    updateTaggingConcurrencyLabel() { if (refs.taggingConcurrencyValue) refs.taggingConcurrencyValue.textContent = String(clamp(refs.taggingConcurrency.value)); }
  });
  async function refreshCredentialReadiness() {
    refs.credentialReadiness.textContent = '检查中';
    try {
      const entries = await apiGet(`/api/platform-credentials?platformCredentialConfigPath=${encodeURIComponent(fieldValue('platformCredentialConfigPath'))}`);
      const configured = entries.filter((entry) => entry.credentialStorePath || entry.cookiesFilePath).length;
      refs.credentialReadiness.textContent = `${configured}/${entries.length} 已配置`;
      refs.credentialReadiness.className = configured > 0 ? 'readiness-ok' : 'readiness-warning';
    } catch { refs.credentialReadiness.textContent = '检查失败'; refs.credentialReadiness.className = 'readiness-warning'; }
  }
  function renderTaxonomyPresetOptions(selected) {
    refs.taxonomyPreset.innerHTML = defaultsPayload.taxonomyPresets.map(option).join('');
    setField('taxonomyPreset', selected || defaultsPayload.defaults.taxonomyPreset);
  }
  return api;
}

function option(item) { return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`; }
function clamp(value) { const parsed = Number.parseInt(String(value), 10); return Math.min(64, Math.max(1, Number.isNaN(parsed) ? 1 : parsed)); }
