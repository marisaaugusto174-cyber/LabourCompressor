import { spawn } from 'node:child_process';

import { type DownloadExecutionProgress } from '../../features/download/domain/index.ts';

export function parseYtDlpProgressLine(line: string): DownloadExecutionProgress | undefined {
  if (!line.startsWith('LCPROGRESS:')) return undefined;
  const [percentRaw = '', speedRaw = '', etaRaw = '', downloadedRaw = '', totalRaw = ''] =
    line.slice('LCPROGRESS:'.length).split('\t');
  const percent = Number(percentRaw.replace('%', '').trim());
  const downloadedBytes = Number(downloadedRaw.trim());
  const totalBytes = Number(totalRaw.trim());
  const speedText = speedRaw.trim();
  const etaText = etaRaw.trim();
  return Object.freeze({
    percent: Number.isFinite(percent) ? percent : undefined,
    speedText: speedText.length > 0 && speedText !== 'N/A' ? speedText : undefined,
    etaText: etaText.length > 0 && etaText !== 'N/A' ? etaText : undefined,
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : undefined,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : undefined
  });
}

export async function runYtDlpProcess(input: {
  readonly binaryPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: DownloadExecutionProgress) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted === true) return reject(createDownloadCancelledError());
    const child = spawn(input.binaryPath, [...input.args], { cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    let settled = false;
    const collect = (target: 'output' | 'error') => createLineCollector((line) => {
      output += `${line}\n`;
      if (target === 'error') stderr += `${line}\n`;
      const progress = parseYtDlpProgressLine(line);
      if (progress !== undefined) input.onProgress?.(progress);
    });
    const flushOutput = collect('output');
    const flushError = collect('error');
    const abort = () => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1500).unref();
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => flushOutput(String(chunk)));
    child.stderr.on('data', (chunk) => flushError(String(chunk)));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code, signal) => finish(() => {
      flushOutput('');
      flushError('');
      if (input.signal?.aborted === true) return reject(createDownloadCancelledError());
      if (code === 0) return resolve(output);
      reject(new Error((stderr || output || `yt-dlp exited with code ${code ?? signal ?? 'unknown'}`).trim()));
    }));
    function finish(action: () => void): void {
      settled = true;
      input.signal?.removeEventListener('abort', abort);
      action();
    }
  });
}

function createLineCollector(onLine: (line: string) => void): (chunk: string) => void {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.length > 0) onLine(line);
    if (chunk.length === 0 && pending.length > 0) {
      onLine(pending);
      pending = '';
    }
  };
}

function createDownloadCancelledError(): Error {
  const error = new Error('Download cancelled.');
  error.name = 'PipelineCancelledError';
  return error;
}
