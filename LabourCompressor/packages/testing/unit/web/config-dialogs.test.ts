import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderModelRowsHtml,
  formatProviderConfigSaveBanner,
  buildPlatformCredentialFieldsHtml,
  formatPlatformCredentialImportBanner,
  formatPlatformCredentialProbeError,
  formatPlatformCredentialProbeResult
} from '../../../../apps/web/public/config-dialogs.js';

test('provider config model list shows model-level API status without secrets', () => {
  const html = buildProviderModelRowsHtml([
    {
      profileId: 'qwen-3.7-plus',
      modelName: 'Qwen3.7Plus',
      provider: 'qwen',
      modelId: 'qwen3.7-plus',
      providerEnabled: true,
      apiKeyPresent: true,
      lastProbe: null
    },
    {
      profileId: 'gemini-3.5-flash',
      modelName: 'Gemini 3.5 Flash',
      provider: 'google',
      modelId: 'gemini-3.5-flash',
      providerEnabled: false,
      apiKeyPresent: false,
      lastProbe: null
    }
  ], 'qwen-3.7-plus');

  assert.equal(html.includes('Qwen3.7Plus'), true);
  assert.equal(html.includes('qwen / qwen3.7-plus'), true);
  assert.equal(html.includes('有'), true);
  assert.equal(html.includes('无'), true);
  assert.equal(html.includes('data-action="set-provider-api-key"'), true);
  assert.equal(html.includes('provider-model-card'), true);
  assert.equal(html.includes('provider-model-main'), true);
  assert.equal(html.includes('provider-model-meta'), true);
  assert.equal(html.includes('provider-model-action'), true);
  assert.equal(html.includes('provider-model-header'), false);
  assert.equal(html.includes('data-action="probe-provider-profile"'), false);
  assert.equal(html.includes('>测试<'), false);
  assert.equal(html.includes('sk-secret'), false);
});

test('provider config banner reports saved probe failure without leaking secrets', () => {
  const text = formatProviderConfigSaveBanner({
    saved: true,
    profile: {
      label: 'Qwen3.7Plus'
    },
    probe: {
      ok: false,
      message: 'API key invalid: sk-secret-test',
      details: {
        provider: 'qwen',
        reason: 'provider-auth-or-quota'
      }
    }
  });

  assert.equal(text.includes('Qwen3.7Plus'), true);
  assert.equal(text.includes('已保存'), true);
  assert.equal(text.includes('连通性未通过'), true);
  assert.equal(text.includes('sk-secret-test'), false);
});

test('platform credential cards expose one import action per platform without advanced inputs', () => {
  const html = buildPlatformCredentialFieldsHtml([
    {
      platform: 'douyin',
      cookiesFilePath: '/tmp/douyin.cookies.txt',
      cookiesFromBrowser: undefined,
      credentialStorePath: '/repo/douyin/cookies.txt',
      credentialUploadedAt: '2026-06-26T08:00:00.000Z'
    }
  ]);

  assert.equal(html.includes('data-action="import-platform-credential"'), true);
  assert.equal(html.includes('data-platform="douyin"'), true);
  assert.equal(html.includes('库内路径'), true);
  assert.equal(html.includes('/repo/douyin/cookies.txt'), true);
  assert.equal(html.includes('上传时间'), true);
  assert.equal(html.includes('2026-06-26T08:00:00.000Z'), true);
  assert.equal(html.includes('测试连通性'), false);
  assert.equal(html.includes('cookies-from-browser'), false);
  assert.equal(html.includes('测试 URL'), false);
  assert.equal(html.includes('data-probe-url-for="douyin"'), false);
  assert.equal(html.includes('data-probe-status-for="douyin"'), true);
});

test('platform credential cards label Xiaohongshu and describe a connectivity probe', () => {
  const html = buildPlatformCredentialFieldsHtml([{
    platform: 'xiaohongshu',
    cookiesFilePath: undefined,
    cookiesFromBrowser: undefined
  }]);

  assert.equal(html.includes('小红书'), true);
  assert.equal(html.includes('data-platform="xiaohongshu"'), true);
  assert.equal(html.includes('导入后自动测试平台连通性'), true);
});

test('platform credential probe formatter explains common douyin protection failures', () => {
  const text = formatPlatformCredentialProbeResult({
    ok: false,
    message: '抖音页面解析或播放地址探测失败：请刷新测试 URL，必要时重新导出 cookies。',
    details: {
      platform: 'douyin',
      errorCode: 'douyin-detail-api-blocked',
      reason: 'douyin-protection'
    }
  });

  assert.equal(text.includes('未通过'), true);
  assert.equal(text.includes('抖音页面解析'), true);
  assert.equal(text.includes('刷新测试 URL'), true);
});

test('platform credential probe formatter shows request failures as failed state', () => {
  const text = formatPlatformCredentialProbeError(new Error('请求超时，请稍后重试。'));

  assert.equal(text.includes('未通过'), true);
  assert.equal(text.includes('请求失败'), true);
  assert.equal(text.includes('请求超时'), true);
});

test('platform credential import banner reports imported probe success', () => {
  const text = formatPlatformCredentialImportBanner({
    probe: {
      ok: true,
      message: 'cookies 连通性测试通过。',
      details: {
        platform: 'douyin',
        sampleUrl: 'https://www.douyin.com/video/123'
      }
    }
  }, 'douyin');

  assert.equal(text.includes('抖音'), true);
  assert.equal(text.includes('导入成功'), true);
  assert.equal(text.includes('测试通过'), true);
});

test('platform credential import banner reports imported probe failure without blocking import', () => {
  const text = formatPlatformCredentialImportBanner({
    probe: {
      ok: false,
      message: '首页没有解析到可测试视频。',
      details: {
        platform: 'tiktok',
        errorCode: 'homepage-video-not-found'
      }
    }
  }, 'tiktok');

  assert.equal(text.includes('TikTok'), true);
  assert.equal(text.includes('已导入'), true);
  assert.equal(text.includes('测试未通过'), true);
  assert.equal(text.includes('首页没有解析到可测试视频'), true);
});
