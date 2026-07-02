#!/usr/bin/env node

import {
  buildOAuthAuthorizationUrl,
  createModelConnectionConfig,
  getEnabledProviderConfig,
  getVideoModelProfile,
  listProviderCatalog,
  loadLocalProviderConfigFile,
  sanitizeLocalProviderConfig,
  validateOAuthAuthorizationUrl,
  validateProviderModelSelection
} from '../../packages/features/tagging/domain/index.ts';
import {
  createGeminiCompatibleClient
} from '../../packages/adapters/models/gemini-compatible-client.ts';
import {
  createQwenCompatibleClient
} from '../../packages/adapters/models/qwen-compatible-client.ts';
import {
  validateFfmpegBinary
} from '../../packages/adapters/media/ffmpeg-merge-operator.ts';
import {
  buildYtDlpArgs,
  extractStructuredDownloadError,
  validateYtDlpBinary
} from '../../packages/adapters/downloaders/ytdlp-downloader.ts';
import {
  createPlatformAwareDownloaderAdapter
} from '../../packages/adapters/downloaders/platform-aware-downloader.ts';
import {
  createDownloadRequest,
  parsePlatformCredentialConfig,
  sanitizePlatformUrlForOutput
} from '../../packages/features/download/domain/index.ts';
import { runLocalPipelineCommand } from './local-pipeline-command.ts';
import { createCliStatusReporter } from './status-reporter.ts';
import { listTaxonomyPresets } from './taxonomy-presets.ts';
import { DEFAULT_PROVIDER_CONFIG_PATH } from './project-paths.ts';
import { buildCliPipelineOptions } from './pipeline/options.ts';

const reporter = createCliStatusReporter({
  log: (line) => console.log(line),
  error: (line) => console.error(line)
});

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

try {
  if (command === 'serve-web-ui') {
    await import('../web/server.ts');
    await new Promise(() => {});
  }

  if (command === 'run-local-pipeline') {
    await runLocalPipelineCommand({
      options: buildCliPipelineOptions(args),
      report: reporter.report
    });
    process.exit(0);
  }

  if (command === 'validate-model-config') {
    validateProviderModelSelection({
      provider: getRequiredArg(args, 'provider') as never,
      modelId: getRequiredArg(args, 'model-name'),
      authMode: getRequiredArg(args, 'auth-mode') as never
    });
    const config = createModelConnectionConfig({
      provider: getRequiredArg(args, 'provider') as never,
      authMode: getRequiredArg(args, 'auth-mode') as 'api-key' | 'oauth',
      modelName: getRequiredArg(args, 'model-name'),
      apiKeyConfig:
        args['auth-mode'] === 'api-key'
          ? {
              apiKey: getRequiredArg(args, 'api-key')
            }
          : undefined,
      oauthConfig:
        args['auth-mode'] === 'oauth'
          ? {
              clientId: getRequiredArg(args, 'client-id'),
              redirectUri: getRequiredArg(args, 'redirect-uri')
            }
          : undefined
    });
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
  }

  if (command === 'list-model-options') {
    console.log(JSON.stringify(listProviderCatalog(), null, 2));
    process.exit(0);
  }

  if (command === 'list-taxonomy-presets') {
    console.log(JSON.stringify(listTaxonomyPresets(), null, 2));
    process.exit(0);
  }

  if (command === 'build-oauth-link') {
    const url = buildOAuthAuthorizationUrl({
      provider: getRequiredArg(args, 'provider') as never,
      authorizeUrl: getRequiredArg(args, 'authorize-url'),
      clientId: getRequiredArg(args, 'client-id'),
      redirectUri: getRequiredArg(args, 'redirect-uri'),
      scopes:
        args.scope === undefined
          ? undefined
          : args.scope.split(',').map((scope) => scope.trim()),
      state: getRequiredArg(args, 'state')
    });
    validateOAuthAuthorizationUrl(url);
    console.log(url);
    process.exit(0);
  }

  if (command === 'validate-download-binaries') {
    const ytdlp = await validateYtDlpBinary(args['yt-dlp-binary']);
    const ffmpeg = await validateFfmpegBinary();
    console.log(JSON.stringify({ ytdlp, ffmpeg }, null, 2));
    process.exit(ytdlp && ffmpeg ? 0 : 1);
  }

  if (command === 'probe-download-url') {
    const request = createDownloadRequest({
      taskId: 'probe-task',
      workflowSessionId: 'probe-workflow',
      rowNumber: 1,
      sourceUrl: getRequiredArg(args, 'url'),
      outputDirectory: getRequiredArg(args, 'output-dir'),
      outputFileStem: 'probe'
    });
    const platformCredentialConfigPath = args['platform-credential-config'];
    const platformCredentialConfig =
      platformCredentialConfigPath === undefined
        ? undefined
        : parsePlatformCredentialConfig(
            JSON.parse(
              await import('node:fs/promises').then(({ readFile }) =>
                readFile(platformCredentialConfigPath, 'utf8')
              )
            )
          );
    const adapter = createPlatformAwareDownloaderAdapter({
      binaryPath: args['yt-dlp-binary'],
      cookiesFilePath: args['cookies-file'],
      cookiesFromBrowser: args['cookies-from-browser'],
      platformCredentialConfig
    });
    console.log(JSON.stringify({
      normalizedUrl: sanitizePlatformUrlForOutput(request.normalizedUrl),
      args: buildYtDlpArgs(request, {
        binaryPath: args['yt-dlp-binary'],
        cookiesFilePath: args['cookies-file'],
        cookiesFromBrowser: args['cookies-from-browser'],
        platformCredentialConfig
      }).map((argument) => argument === request.normalizedUrl
        ? sanitizePlatformUrlForOutput(argument)
        : argument)
    }, null, 2));
    try {
      await adapter.download(request);
      console.log(JSON.stringify({
        probeStatus: 'ok'
      }, null, 2));
      process.exit(0);
    } catch (error) {
      const structuredError = extractStructuredDownloadError(error);
      console.log(JSON.stringify({
        status: structuredError.errorCode,
        message: structuredError.errorMessage,
        detail: structuredError.errorDetail
      }, null, 2));
      process.exit(1);
    }
  }

  if (command === 'probe-model-provider') {
    const provider = getRequiredArg(args, 'provider') as never;
    const selectedProfile = getVideoModelProfile(
      args['selected-model-profile-id'] ?? profileIdFromProvider(provider)
    );
    const configMap = await loadLocalProviderConfigFile(
      args['provider-config'] ??
        DEFAULT_PROVIDER_CONFIG_PATH
    );
    const config = getEnabledProviderConfig(configMap, selectedProfile.provider);
    const resolvedConfig = Object.freeze({
      ...config,
      provider: selectedProfile.provider,
      modelName: selectedProfile.modelName
    });

    console.log(
      JSON.stringify(
        {
          profile: selectedProfile,
          config: sanitizeLocalProviderConfig(resolvedConfig)
        },
        null,
        2
      )
    );

    if (selectedProfile.provider === 'qwen') {
      const client = createQwenCompatibleClient(resolvedConfig);
      const result = await client.probe({
        prompt:
          args.prompt ??
          '请只回复字符串 OK，不要包含额外解释。'
      });
      console.log(
        JSON.stringify(
          {
            probeStatus: 'ok',
            model: result.model,
            text: result.text,
            requestId: result.requestId,
            usage: result.usage
          },
          null,
          2
        )
      );
      process.exit(0);
    }

    if (selectedProfile.provider === 'google') {
      const client = createGeminiCompatibleClient(resolvedConfig);
      const result = await client.probe({
        prompt:
          args.prompt ??
          'Please reply with the exact string OK and nothing else.'
      });
      console.log(
        JSON.stringify(
          {
            probeStatus: 'ok',
            model: result.model,
            text: result.text
          },
          null,
          2
        )
      );
      process.exit(0);
    }

    throw new Error(`Provider probe is not implemented yet for "${selectedProfile.provider}".`);
  }

  printUsage();
  process.exit(command === undefined ? 0 : 1);
} catch (error) {
  reporter.reportError(command ?? 'cli', error);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  const booleanFlags = new Set(['auto-segmentation']);

  for (let index = 0; index < argv.length;) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === undefined || !key.startsWith('--')) {
      throw new Error('CLI arguments must be provided as --key value pairs.');
    }

    if (value === undefined || value.startsWith('--')) {
      if (!booleanFlags.has(key.slice(2))) {
        throw new Error(`CLI argument --${key.slice(2)} requires a value.`);
      }
      parsed[key.slice(2)] = 'true';
      index += 1;
      continue;
    }

    parsed[key.slice(2)] = value;
    index += 2;
  }

  return parsed;
}

function getRequiredArg(args: Record<string, string>, key: string): string {
  const value = args[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required CLI argument: --${key}`);
  }

  return value.trim();
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  node apps/cli/main.ts serve-web-ui',
      '  node apps/cli/main.ts run-local-pipeline --spreadsheet <path> --download-dir <path> [--taxonomy <path> | --taxonomy-preset core-v0.1|full-v0.2|core-v0.3-drama] [--prompt-library <path>] --archive-root <path> [--download-fixtures <path>] [--candidate-fixtures <path>] [--downloader-mode simulated|yt-dlp] [--merge-mode local|ffmpeg] [--tagging-mode simulated|qwen] [--provider-config <path>] [--selected-model-profile-id <id>] [--manual-edit-gate true|false] [--after-edit-directory-name <name>] [--auto-segmentation] [--segmentation-profile standard_ad|fast_cut|conservative] [--problem-clips-directory-name <name>]',
      '  V0.5.1 staged mode: add --pipeline-stage download|segment|compress|tag|archive|all',
      '    Optional writeback: [--writeback-target user|master|both] [--master-spreadsheet <path>]',
      '  node apps/cli/main.ts list-taxonomy-presets',
      '  node apps/cli/main.ts list-model-options',
      '  node apps/cli/main.ts validate-model-config --provider <provider> --auth-mode <api-key|oauth> --model-name <name> [--api-key <key> | --client-id <id> --redirect-uri <uri>]',
      '  node apps/cli/main.ts build-oauth-link --provider <provider> --authorize-url <url> --client-id <id> --redirect-uri <uri> --state <state> [--scope a,b,c]',
      '  node apps/cli/main.ts validate-download-binaries [--yt-dlp-binary <path>]',
      '  node apps/cli/main.ts probe-download-url --url <url> --output-dir <path> [--yt-dlp-binary <path>] [--platform-credential-config <path>] [--cookies-file <path> | --cookies-from-browser <browser>]',
      '  node apps/cli/main.ts probe-model-provider --provider <provider> [--provider-config <path>] [--selected-model-profile-id <id>] [--prompt <text>]'
    ].join('\n')
  );
}

function profileIdFromProvider(provider: string): string {
  if (provider === 'qwen') {
    return 'qwen-3.7-plus';
  }

  if (provider === 'google') {
    return 'gemini-3.5-flash';
  }

  throw new Error(`No default video model profile is defined for provider "${provider}".`);
}
