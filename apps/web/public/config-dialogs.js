import { apiGet, apiPost, buildDebugJson } from './api-client.js';
import { escapeHtml, fieldValue, updateFilledState } from './form-state.js';

let refs = {};
let bindPickerButtons = () => {};

export function initConfigDialogs(options) {
  refs = options.refs;
  bindPickerButtons = options.bindPickerButtons;
}

export async function openProviderConfigDialog() {
  try {
    const payload = await apiPost('/api/provider-config/summary', {
      providerConfigPath: fieldValue('providerConfigPath'),
      selectedModelProfileId: fieldValue('selectedModelProfileId')
    });

    refs.providerConfigProfileLabel.textContent = payload.profile.label;
    refs.providerConfigProviderLabel.textContent = `${payload.profile.provider} / ${payload.profile.modelName}`;
    refs.providerConfigStatusLabel.textContent = payload.summary.enabled
      ? `${payload.summary.provider} 已启用，当前 model = ${payload.summary.modelName}${payload.summary.apiKeyPresent ? '，已配置 API key' : '，未配置 API key'}`
      : `${payload.summary.provider} 未启用`;
    refs.providerConfigOutput.textContent = buildDebugJson(payload);
  } catch (error) {
    refs.providerConfigProfileLabel.textContent = '当前选择的模型';
    refs.providerConfigProviderLabel.textContent = '等待本地配置';
    refs.providerConfigStatusLabel.textContent = '配置文件暂不可读';
    refs.providerConfigOutput.textContent = [
      '无法读取本地模型配置。',
      '',
      '请先确认你是通过 npm run web 启动，并且已经执行 npm run setup:mac 或 npm run setup:windows。',
      '如果仍然失败，请关闭 Web UI 后重新运行 npm run web。',
      '',
      `技术信息：${error instanceof Error ? error.message : String(error)}`
    ].join('\n');
  }
  refs.providerApiKeyInput.value = '';
  refs.providerConfigDialog.showModal();
}

export async function saveProviderConfig() {
  const apiKey = refs.providerApiKeyInput.value.trim();

  if (apiKey.length === 0) {
    refs.providerConfigOutput.textContent = '请先填写 API key。';
    refs.providerApiKeyInput.focus();
    return;
  }

  refs.providerConfigOutput.textContent = '正在保存配置并测试连通性...';
  const payload = await apiPost('/api/provider-config/save-api-key', {
    providerConfigPath: fieldValue('providerConfigPath'),
    selectedModelProfileId: fieldValue('selectedModelProfileId'),
    apiKey
  });
  refs.providerApiKeyInput.value = '';
  refs.providerConfigOutput.textContent = buildDebugJson(payload);
  await openProviderConfigDialog();
}

export async function openPlatformCredentialsDialog() {
  const payload = await apiGet(
    `/api/platform-credentials?platformCredentialConfigPath=${encodeURIComponent(fieldValue('platformCredentialConfigPath'))}`
  );
  renderPlatformCredentialFields(payload);
  refs.platformCredentialsOutput.textContent = buildDebugJson(payload);
  refs.platformCredentialsDialog.showModal();
}

export async function savePlatformCredentials() {
  const rows = [...refs.platformCredentialsFields.querySelectorAll('[data-platform]')];
  const results = [];

  for (const row of rows) {
    const platform = row.dataset.platform;
    if (!platform) {
      continue;
    }

    const cookiesFilePath = row.querySelector(`[name="${CSS.escape(platform)}-cookies-file"]`)?.value?.trim() ?? '';
    const cookiesFromBrowser = row.querySelector(`[name="${CSS.escape(platform)}-cookies-browser"]`)?.value?.trim() ?? '';

    results.push(
      await apiPost('/api/platform-credentials/save', {
        platformCredentialConfigPath: fieldValue('platformCredentialConfigPath'),
        platform,
        cookiesFilePath,
        cookiesFromBrowser
      })
    );
  }

  const latest = results.at(-1) ?? [];
  renderPlatformCredentialFields(latest);
  refs.platformCredentialsOutput.textContent = buildDebugJson(latest);
}

function renderPlatformCredentialFields(entries) {
  refs.platformCredentialsFields.innerHTML = entries
    .map((entry) => {
      const platformLabel = {
        bilibili: 'Bilibili',
        youtube: 'YouTube',
        douyin: '抖音',
        tiktok: 'TikTok'
      }[entry.platform] ?? entry.platform;

      return `
        <section class="platform-credential-card" data-platform="${escapeHtml(entry.platform)}">
          <h3>${escapeHtml(platformLabel)}</h3>
          <div class="path-field is-filled">
            <div class="path-meta">
              <label for="${escapeHtml(entry.platform)}-cookies-file">cookies.txt</label>
              <span>优先用于需要登录态、最高码率或风控更严的内容。</span>
            </div>
            <div class="path-control">
              <input id="${escapeHtml(entry.platform)}-cookies-file" name="${escapeHtml(entry.platform)}-cookies-file" value="${escapeHtml(entry.cookiesFilePath ?? '')}" />
              <button
                class="picker-button"
                type="button"
                data-dialog-kind="file"
                data-target="${escapeHtml(entry.platform)}-cookies-file"
                data-prompt="选择 ${escapeHtml(platformLabel)} cookies.txt"
              >
                选择文件
              </button>
            </div>
          </div>
          <label>
            cookies-from-browser
            <input id="${escapeHtml(entry.platform)}-cookies-browser" name="${escapeHtml(entry.platform)}-cookies-browser" value="${escapeHtml(entry.cookiesFromBrowser ?? '')}" placeholder="例如 chrome / safari / firefox" />
          </label>
        </section>
      `;
    })
    .join('');
  bindPickerButtons();
  updateFilledState();
}
