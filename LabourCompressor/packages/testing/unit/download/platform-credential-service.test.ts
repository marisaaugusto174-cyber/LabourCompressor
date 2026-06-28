import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPlatformCredentialService,
  type PlatformCredentialRepository,
  type PlatformCredentialProbePort
} from '../../../features/download/application/platform-credential-service.ts';

test('imports a credential before probing the managed entry', async () => {
  const calls: string[] = [];
  const repository: PlatformCredentialRepository = {
    async list() {
      calls.push('list');
      return [{ platform: 'xiaohongshu', cookiesFilePath: '/managed/cookies.txt' }];
    },
    async save() { calls.push('save'); return this.list(); },
    async importFile() { calls.push('import'); return this.list(); }
  };
  const probe: PlatformCredentialProbePort = {
    async probeCredential(input) {
      calls.push(`probe:${input.cookiesFilePath}`);
      return { key: 'probe', ok: true, message: 'ok', details: {} };
    },
    async probeDownload() {
      throw new Error('not used');
    }
  };
  const service = createPlatformCredentialService({ repository, probe });

  const result = await service.importAndProbe({
    platform: 'xiaohongshu',
    sourceCookiesFilePath: '/incoming/cookies.txt'
  });

  assert.equal(result.probe.ok, true);
  assert.deepEqual(calls, ['import', 'list', 'probe:/managed/cookies.txt']);
});
