import { type SupportedPlatform } from '../../packages/features/download/domain/index.ts';

export interface RuntimeCheckResult {
  readonly key: string;
  readonly ok: boolean;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>> | undefined;
}

export interface VideoCacheStats {
  readonly rootDirectory: string;
  readonly exists: boolean;
  readonly bucketCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly entries: readonly VideoCacheEntry[];
}

export interface VideoCacheEntry {
  readonly bucketId: string;
  readonly cachePath: string;
  readonly profileId: string;
  readonly sourceDurationSec: number;
  readonly sourceFps: number;
  readonly cacheSizeBytes: number;
}

export interface LocalDialogResult {
  readonly cancelled: boolean;
  readonly path: string | null;
}

export interface PlatformCredentialSummaryEntry {
  readonly platform: SupportedPlatform;
  readonly cookiesFilePath?: string | undefined;
  readonly cookiesFromBrowser?: string | undefined;
  readonly credentialStorePath?: string | undefined;
  readonly credentialUploadedAt?: string | undefined;
}
