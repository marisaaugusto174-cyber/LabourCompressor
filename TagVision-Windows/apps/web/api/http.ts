import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import { type WebApiContext } from './context.ts';

export interface WebRouteInput {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly context: WebApiContext;
}

export type WebRouteHandler = (input: WebRouteInput) => Promise<boolean>;

export async function serveStatic(
  response: ServerResponse,
  publicDir: string,
  fileName: string,
  contentType: string
): Promise<void> {
  const filePath = path.join(publicDir, fileName);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  response.end(await readFile(filePath));
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function readBinaryBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export function sendJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function requireBodyString(body: Record<string, unknown>, key: string): string {
  const value = readString(body[key]);

  if (value.length === 0) {
    throw new Error(`Missing required body field: ${key}`);
  }

  return value;
}

export function requireQueryString(url: URL, key: string): string {
  const value = readString(url.searchParams.get(key));

  if (value.length === 0) {
    throw new Error(`Missing required query parameter: ${key}`);
  }

  return value;
}

export function buildLocalUrl(request: IncomingMessage, context: WebApiContext, pathname: string): string {
  const host = request.headers.host ?? `${context.webHost}:${context.webPort}`;
  return `http://${host}${pathname}`;
}

export function buildCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
