import { apiGet, apiPost, buildDebugJson } from './api-client.js';
import { escapeHtml, fieldValue, setField, updateFilledState } from './form-state.js';

let refs = {};
let bindPickerButtons = () => {};
let currentProviderProfileId = '';

export function initConfigDialogs(options) {
  refs = options.refs;
  bindPickerButtons = options.bindPickerButtons;
}

export async function openProviderConfigDialog() {
  try {
    const payload = await apiPost('/api/provider-config/model-summary', {
      providerConfigPath: fieldValue('providerConfigPath')
    });
    currentProviderProfileId = fieldValue('selectedModelProfileId') || payload.models?.[0]?.profileId || '';
    renderProviderModelList(payload.models ?? []);
    hideProviderConfigBanner();
    refs.providerConfigOutput.textContent = '';
    refs.providerConfigOutput.classList.add('hidden');
  } catch (error) {
    refs.providerModelList.innerHTML = '<p>—</p>';
    hideProviderConfigBanner();
    refs.providerConfigOutput.classList.remove('hidden');
    refs.providerConfigOutput.textContent = [
      isFetchFailure(error)
        ? '无法连接本地 Web UI 服务。'
        : '无法读取本地模型配置。',
      '',
      'http://127.0.0.1:4311/',
      '',
      `技术信息：${error instanceof Error ? error.message : String(error)}`
    ].join('\n');
  }
  if (!refs.providerConfigDialog.open) {
    refs.providerConfigDialog.showModal();
  }
}

function renderProviderModelList(models) {
  refs.providerModelList.innerHTML = buildProviderModelRowsHtml(models, currentProviderProfileId);
  refs.providerModelList
    .querySelectorAll('[data-action="set-provider-api-key"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        setProviderApiKey(button).catch((error) => {
          const message = sanitizeProviderMessage(error instanceof Error ? error.message : String(error));
          showProviderConfigBanner(message, false);
          refs.providerConfigOutput.classList.remove('hidden');
          refs.providerConfigOutput.textContent = message;
        });
      });
    });
}

export function buildProviderModelRowsHtml(models, selectedProfileId = '') {
  if (!models.length) {
    return '<p>—</p>';
  }

  return `
    ${models.map((model) => `
      <section class="provider-model-card ${model.profileId === selectedProfileId ? 'is-selected' : ''}" data-model-profile-id="${escapeHtml(model.profileId)}">
        <div class="provider-model-main">
          <strong>${escapeHtml(model.modelName)}</strong>
          <span class="stage-pill ${model.apiKeyPresent ? 'stage-succeeded' : 'stage-failed'}">${model.apiKeyPresent ? '有 API Key' : '无 API Key'}</span>
        </div>
        <div class="provider-model-meta">
          <span>${escapeHtml(model.provider)} / ${escapeHtml(model.modelId)}</span>
          <span>${escapeHtml(renderProviderProbeStatus(model))}</span>
        </div>
        <div class="provider-model-action">
          <button
            type="button"
            class="secondary-button provider-api-key-set"
            data-action="set-provider-api-key"
            data-profile-id="${escapeHtml(model.profileId)}"
            data-model-name="${escapeHtml(model.modelName)}"
          >${model.apiKeyPresent ? '替换 API Key' : '设置 API Key'}</button>
        </div>
      </section>
    `).join('')}
  `;
}

async function setProviderApiKey(button) {
  const selectedModelProfileId = button.dataset.profileId;
  const modelName = button.dataset.modelName || selectedModelProfileId || '当前模型';

  if (!selectedModelProfileId) {
    return;
  }

  const apiKey = window.prompt(`输入 ${modelName} 对应 Provider 的 API Key`);
  if (apiKey === null) {
    return;
  }

  const trimmedApiKey = apiKey.trim();
  if (trimmedApiKey.length === 0) {
    showProviderConfigBanner('API Key 为空，未保存。', false);
    return;
  }

  button.disabled = true;
  showProviderConfigBanner(`${modelName} 正在保存并测试连通性...`, null);

  try {
    currentProviderProfileId = selectedModelProfileId;
    setField('selectedModelProfileId', selectedModelProfileId);
    const payload = await apiPost('/api/provider-config/save-api-key', {
      providerConfigPath: fieldValue('providerConfigPath'),
      selectedModelProfileId,
      apiKey: trimmedApiKey
    }, { timeoutMs: 75_000 });
    const summary = await apiPost('/api/provider-config/model-summary', {
      providerConfigPath: fieldValue('providerConfigPath')
    });
    renderProviderModelList(summary.models ?? []);
    showProviderConfigBanner(formatProviderConfigSaveBanner(payload), payload.probe?.ok === true);
    refs.providerConfigOutput.textContent = buildDebugJson(payload);
  } finally {
    button.disabled = false;
  }
}

function showProviderConfigBanner(message, ok) {
  if (!refs.providerConfigBanner) {
    return;
  }

  refs.providerConfigBanner.textContent = message;
  refs.providerConfigBanner.className = [
    'provider-config-banner',
    ok === true ? 'is-ok' : '',
    ok === false ? 'is-failed' : '',
    ok === null ? 'is-running' : ''
  ].filter((value) => value.length > 0).join(' ');
}

function hideProviderConfigBanner() {
  if (!refs.providerConfigBanner) {
    return;
  }

  refs.providerConfigBanner.textContent = '';
  refs.providerConfigBanner.className = 'provider-config-banner hidden';
}

export function formatProviderConfigSaveBanner(payload) {
  const modelLabel = payload?.profile?.label ?? payload?.profile?.modelName ?? '模型 API';
  const probe = payload?.probe;

  if (probe?.ok === true) {
    return `${modelLabel} API Key 已保存，连通性测试通过。`;
  }

  if (probe?.ok === false) {
    return sanitizeProviderMessage(`${modelLabel} API Key 已保存，连通性未通过。${probe.message ?? ''}`);
  }

  return `${modelLabel} API Key 已保存，连通性结果未知。`;
}

function sanitizeProviderMessage(message) {
  return String(message).replace(/sk-[A-Za-z0-9_-]+/gu, '[REDACTED]');
}

function renderProviderProbeStatus(model) {
  if (model.lastProbe?.ok === true) {
    return '已通过';
  }
  if (model.lastProbe?.ok === false) {
    return '未通过';
  }
  return model.providerEnabled ? '未测试' : 'provider 未启用';
}

export async function openPlatformCredentialsDialog() {
  try {
    const payload = await apiGet(
      `/api/platform-credentials?platformCredentialConfigPath=${encodeURIComponent(fieldValue('platformCredentialConfigPath'))}`
    );
    renderPlatformCredentialFields(payload);
    hidePlatformCredentialBanner();
    refs.platformCredentialsOutput.textContent = '';
    refs.platformCredentialsOutput.classList.add('hidden');
  } catch (error) {
    refs.platformCredentialsFields.innerHTML = '';
    hidePlatformCredentialBanner();
    refs.platformCredentialsOutput.classList.remove('hidden');
    refs.platformCredentialsOutput.textContent = [
      isFetchFailure(error)
        ? '无法连接本地 Web UI 服务。'
        : '无法读取本地下载凭证配置。',
      '',
      'http://127.0.0.1:4311/',
      '',
      `技术信息：${error instanceof Error ? error.message : String(error)}`
    ].join('\n');
  }
  refs.platformCredentialsDialog.showModal();
}

function renderPlatformCredentialFields(entries) {
  refs.platformCredentialsFields.innerHTML = buildPlatformCredentialFieldsHtml(entries);
  bindPlatformCredentialTestButtons();
  updateFilledState();
}

export function buildPlatformCredentialFieldsHtml(entries) {
  return entries
    .map((entry) => {
      const platformLabel = getPlatformLabel(entry.platform);

      return `
        <section class="platform-credential-card" data-platform="${escapeHtml(entry.platform)}">
          <div class="platform-credential-header">
            <h3>${escapeHtml(platformLabel)}</h3>
            <div class="actions compact">
              <button
                class="secondary-button platform-credential-import"
                type="button"
                data-action="import-platform-credential"
                data-platform="${escapeHtml(entry.platform)}"
                data-platform-label="${escapeHtml(platformLabel)}"
                data-current-path="${escapeHtml(entry.credentialStorePath ?? entry.cookiesFilePath ?? '')}"
              >
                导入凭证
              </button>
            </div>
          </div>
          <div class="platform-credential-status">
            <span>当前状态</span>
            <strong>${entry.credentialStorePath || entry.cookiesFilePath ? '已导入' : '未导入'}</strong>
            <span>库内路径</span>
            <strong>${escapeHtml(entry.credentialStorePath ?? entry.cookiesFilePath ?? '—')}</strong>
            <span>上传时间</span>
            <strong>${escapeHtml(entry.credentialUploadedAt ?? '—')}</strong>
          </div>
          <div class="platform-credential-status" data-probe-status-for="${escapeHtml(entry.platform)}">导入后自动测试平台连通性</div>
        </section>
      `;
    })
    .join('');
}

function bindPlatformCredentialTestButtons() {
  refs.platformCredentialsFields
    .querySelectorAll('[data-action="import-platform-credential"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        importPlatformCredential(button).catch((error) => {
          refs.platformCredentialsOutput.textContent = error instanceof Error
            ? error.message
            : String(error);
          refs.platformCredentialsOutput.classList.remove('hidden');
          showPlatformCredentialBanner(
            error instanceof Error ? error.message : String(error),
            false
          );
        });
      });
    });
}

async function importPlatformCredential(button) {
  const platform = button.dataset.platform;
  const platformLabel = button.dataset.platformLabel || getPlatformLabel(platform);

  if (platform === undefined) {
    return;
  }

  const selectedFile = await apiPost('/api/dialog/open-file', {
    prompt: `选择 ${platformLabel} cookies.txt`,
    defaultPath: button.dataset.currentPath || undefined
  });

  if (selectedFile.cancelled || typeof selectedFile.path !== 'string' || selectedFile.path.length === 0) {
    return;
  }

  button.disabled = true;
  showPlatformCredentialBanner(`${platformLabel} 正在导入并自动测试...`, null);

  try {
    const payload = await apiPost('/api/platform-credentials/import', {
      platformCredentialConfigPath: fieldValue('platformCredentialConfigPath'),
      platform,
      cookiesFilePath: selectedFile.path,
      ytDlpBinary: fieldValue('ytDlpBinary')
    }, { timeoutMs: 75_000 });
    renderPlatformCredentialFields(payload.summary ?? payload);
    renderPlatformCredentialProbeStatus(platform, payload.probe);
    showPlatformCredentialBanner(formatPlatformCredentialImportBanner(payload, platform), payload.probe?.ok === true);
    refs.platformCredentialsOutput.textContent = buildDebugJson(payload);
  } finally {
    button.disabled = false;
  }
}

function renderPlatformCredentialProbeStatus(platform, probe) {
  const row = platform === undefined
    ? null
    : refs.platformCredentialsFields.querySelector(`[data-platform="${CSS.escape(platform)}"]`);
  const statusNode = row?.querySelector(`[data-probe-status-for="${CSS.escape(platform)}"]`) ?? null;

  if (statusNode !== null && probe !== undefined) {
    statusNode.textContent = formatPlatformCredentialProbeResult(probe);
    statusNode.className = `platform-credential-status ${probe.ok ? 'is-ok' : 'is-failed'}`;
  }
}

function showPlatformCredentialBanner(message, ok) {
  if (!refs.platformCredentialsBanner) {
    return;
  }

  refs.platformCredentialsBanner.textContent = message;
  refs.platformCredentialsBanner.className = [
    'platform-credential-banner',
    ok === true ? 'is-ok' : '',
    ok === false ? 'is-failed' : '',
    ok === null ? 'is-running' : ''
  ].filter((value) => value.length > 0).join(' ');
}

function hidePlatformCredentialBanner() {
  if (!refs.platformCredentialsBanner) {
    return;
  }

  refs.platformCredentialsBanner.textContent = '';
  refs.platformCredentialsBanner.className = 'platform-credential-banner hidden';
}

export function formatPlatformCredentialImportBanner(payload, platform) {
  const platformLabel = getPlatformLabel(platform ?? payload?.probe?.details?.platform);
  const probe = payload?.probe;

  if (probe?.ok === true) {
    return `${platformLabel} 导入成功，首页首个视频测试通过。`;
  }

  if (probe?.ok === false) {
    const summary = formatPlatformCredentialProbeResult(probe);
    return [`${platformLabel} 已导入，自动测试未通过。`, summary]
      .filter((value) => value.length > 0)
      .join(' ');
  }

  return `${platformLabel} 已导入，自动测试结果未知。`;
}

export function formatPlatformCredentialProbeResult(payload) {
  const ok = payload?.ok === true;
  const details = payload?.details ?? {};
  const message = String(payload?.message ?? '');
  const label = ok ? '已通过' : '未通过';
  const reason = String(details.reason ?? details.errorCode ?? '');
  const cause = formatCredentialProbeCause(reason);

  return [label, cause, message]
    .filter((value) => value.length > 0)
    .join(' · ');
}

export function formatPlatformCredentialProbeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return ['未通过', '请求失败', message]
    .filter((value) => value.length > 0)
    .join(' · ');
}

function formatCredentialProbeCause(reason) {
  switch (reason) {
    case 'cookies':
    case 'missing-credentials':
    case 'needs-fresh-cookies':
    case 'cookies-expired':
      return 'Cookies 需要更新';
    case 'douyin-protection':
    case 'douyin-extractor-challenge':
    case 'douyin-detail-api-blocked':
    case 'douyin-ssr-unavailable':
    case 'douyin-play-url-expired':
      return '抖音页面解析';
    case 'rate-limit':
    case 'platform-rate-limited':
      return '平台限流';
    case 'runtime':
    case 'runtime-error':
      return '本地下载器异常';
    case 'xiaohongshu-homepage':
      return '小红书平台连通性';
    case 'credential-domain-mismatch':
      return 'Cookies 平台不匹配';
    case 'credential-file-unreadable':
    case 'credential-file-empty':
      return 'Cookies 文件不可读';
    case 'sample-url':
    case 'unsupported-url':
      return '自动测试视频不可用';
    default:
      return '';
  }
}

function getPlatformLabel(platform) {
  return {
    bilibili: 'Bilibili',
    youtube: 'YouTube',
    douyin: '抖音',
    tiktok: 'TikTok',
    xiaohongshu: '小红书'
  }[platform] ?? platform ?? '平台';
}

function isFetchFailure(error) {
  return error instanceof TypeError && /fetch/iu.test(error.message);
}
