import { type SupportedPlatform } from '../domain/index.ts';

export interface PlatformCredentialSummary {
  readonly platform: SupportedPlatform;
  readonly cookiesFilePath?: string;
  readonly cookiesFromBrowser?: string;
  readonly credentialStorePath?: string;
  readonly credentialUploadedAt?: string;
}

export interface PlatformOperationResult {
  readonly key: string;
  readonly ok: boolean;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface PlatformCredentialRepository {
  list(): Promise<readonly PlatformCredentialSummary[]>;
  save(input: {
    readonly platform: SupportedPlatform;
    readonly cookiesFilePath?: string;
    readonly cookiesFromBrowser?: string;
  }): Promise<readonly PlatformCredentialSummary[]>;
  importFile(input: {
    readonly platform: SupportedPlatform;
    readonly sourceCookiesFilePath: string;
    readonly now?: Date;
  }): Promise<readonly PlatformCredentialSummary[]>;
}

export interface PlatformCredentialProbePort {
  probeCredential(input: {
    readonly platform: SupportedPlatform;
    readonly cookiesFilePath?: string;
    readonly cookiesFromBrowser?: string;
    readonly sampleUrl?: string;
    readonly now?: Date;
  }): Promise<PlatformOperationResult>;
  probeDownload(input: {
    readonly url: string;
    readonly outputDirectory: string;
  }): Promise<PlatformOperationResult>;
}

export function createPlatformCredentialService(dependencies: {
  readonly repository: PlatformCredentialRepository;
  readonly probe: PlatformCredentialProbePort;
}) {
  return Object.freeze({
    list: () => dependencies.repository.list(),
    save: (input: Parameters<PlatformCredentialRepository['save']>[0]) =>
      dependencies.repository.save(input),
    probeCredential: (input: Parameters<PlatformCredentialProbePort['probeCredential']>[0]) =>
      dependencies.probe.probeCredential(input),
    probeDownload: (input: Parameters<PlatformCredentialProbePort['probeDownload']>[0]) =>
      dependencies.probe.probeDownload(input),
    async importAndProbe(input: {
      readonly platform: SupportedPlatform;
      readonly sourceCookiesFilePath: string;
      readonly now?: Date;
      readonly sampleUrl?: string;
    }) {
      const summary = await dependencies.repository.importFile(input);
      const entry = summary.find((candidate) => candidate.platform === input.platform);
      const probe = await dependencies.probe.probeCredential({
        platform: input.platform,
        cookiesFilePath: entry?.cookiesFilePath,
        cookiesFromBrowser: entry?.cookiesFromBrowser,
        sampleUrl: input.sampleUrl,
        now: input.now
      });
      return Object.freeze({ summary, probe });
    }
  });
}
