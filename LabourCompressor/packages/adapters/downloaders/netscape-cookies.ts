import { readFile } from 'node:fs/promises';

export async function readNetscapeCookieHeader(
  filePath: string,
  targetDomains: readonly string[],
  now = new Date()
): Promise<string> {
  try {
    const nowSeconds = Math.floor(now.getTime() / 1000);

    return (await readFile(filePath, 'utf8'))
      .split(/\r?\n/u)
      .map((line) => normalizeHttpOnlyLine(line.trim()))
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('\t'))
      .filter((columns) => columns.length >= 7)
      .filter((columns) => targetDomains.some((domain) =>
        cookieDomainMatches(normalizeCookieDomain(columns[0] ?? ''), domain)
      ))
      .filter((columns) => {
        const expiresAt = Number(columns[4]);
        return !Number.isFinite(expiresAt) || expiresAt === 0 || expiresAt > nowSeconds;
      })
      .map((columns) => `${columns[5] ?? ''}=${columns[6] ?? ''}`)
      .filter((value) => !value.startsWith('='))
      .join('; ');
  } catch {
    return '';
  }
}

function normalizeHttpOnlyLine(line: string): string {
  return line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
}

function normalizeCookieDomain(domain: string): string {
  return domain.trim().replace(/^\./u, '').toLowerCase();
}

function cookieDomainMatches(cookieDomain: string, targetDomain: string): boolean {
  const normalizedTarget = normalizeCookieDomain(targetDomain);
  return cookieDomain === normalizedTarget || cookieDomain.endsWith(`.${normalizedTarget}`);
}
