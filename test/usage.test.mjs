import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLimits, readUsage } from '../src/usage.mjs';

test('all rate-limit buckets preserved, nulls unknown, remaining clamped', () => {
  const rows = normalizeLimits({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 123 }, secondary: { usedPercent: null } },
    review: { primary: { usedPercent: 105 } },
  } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].primary.remainingPercent, 75);
  assert.equal(rows[0].secondary.remainingPercent, null);
  assert.equal(rows[1].primary.remainingPercent, 0);
  assert.deepEqual(normalizeLimits({}), []);
});

function fakeCodex(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'slider-rpc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'codex');
  writeFileSync(file, `#!${process.execPath}\n
    const readline = require('node:readline');
    const mode = ${JSON.stringify(mode)};
    let initialized = false;
    const reply = v => process.stdout.write(JSON.stringify(v)+'\\n');
    const reader = readline.createInterface({ input: process.stdin });
    reader.on('line', line => {
      const m = JSON.parse(line);
      if (mode === 'timeout') return;
      if (m.method === 'initialize') return reply({ id: 1, result: {} });
      if (m.method === 'initialized') { initialized = true; return; }
      if (!initialized || !['account/read','account/rateLimits/read'].includes(m.method)) process.exit(21);
      if (m.method === 'account/read') {
        if (process.env.OPENAI_API_KEY || process.env.CODEX_HOME !== ${JSON.stringify(dir)}) process.exit(22);
        return reply({ id: 2, result: { account: mode === 'signed_out' ? null : { type: 'chatgpt', email: 'test@example.com', planType: 'plus', accessToken: 'DO-NOT-EXPOSE' } } });
      }
      if (mode === 'error') return reply({ id: 3, error: { message: 'SENSITIVE-BACKEND-DATA' } });
      reply({ id: 3, result: { accountId: mode === 'no-workspace' ? null : 'workspace-123', rateLimits: { primary: { usedPercent: 30 } } } });
    });
  `, { mode: 0o700 });
  return { file, dir };
}

test('RPC follows handshake, sanitizes output and uses no model turns', async t => {
  const { file, dir } = fakeCodex(t, 'ok');
  const result = await readUsage({ id: 'a', label: 'A', codex_home: dir }, { command: file });
  assert.equal(result.status, 'ok');
  assert.equal(result.limits[0].primary.remainingPercent, 70);
  assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'), false);
});

test('signed-out, failure, timeout, and unmapped desktop labels remain distinct', async t => {
  for (const mode of ['signed_out', 'error', 'timeout']) {
    const { file, dir } = fakeCodex(t, mode);
    const result = await readUsage({ id: 'a', label: 'A', codex_home: dir }, { command: file, timeoutMs: mode === 'timeout' ? 200 : 3000 });
    assert.equal(result.status, mode === 'error' ? 'unavailable' : mode);
    assert.deepEqual(result.limits, []);
    assert.equal(JSON.stringify(result).includes('SENSITIVE-BACKEND-DATA'), false);
  }
  assert.equal((await readUsage({ id: 'desktop', label: 'Desktop' })).status, 'unavailable');
});

test('current account is independent of storage profiles and does not wait for usage', async t => {
  const { readCurrentAccount } = await import('../src/usage.mjs');
  const { file, dir } = fakeCodex(t, 'error');
  const result = await readCurrentAccount({ codexHome: dir, command: file });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.account, { type: 'chatgpt', email: 'test@example.com', planType: 'plus' });
  assert.equal(result.source, 'local-codex');
  assert.equal(result.desktopAccountVerified, false);
  assert.equal(result.workspace, null);
  assert.equal('profile' in result, false);
  assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'), false);
  const signedOut = fakeCodex(t, 'signed_out');
  assert.equal((await readCurrentAccount({ codexHome: signedOut.dir, command: signedOut.file })).status, 'signed_out');
});


test('workspace ID comes from backend only and is not inferred from plan or email', async t => {
  const { readCurrentWorkspace } = await import('../src/usage.mjs');
  for (const mode of ['ok', 'no-workspace', 'error', 'signed_out']) {
    const { file, dir } = fakeCodex(t, mode);
    const r = await readCurrentWorkspace({ codexHome: dir, command: file });
    assert.deepEqual(r.workspace, mode === 'ok' ? { id: 'workspace-123', name: null } : null);
    assert.equal(r.desktopAccountVerified, false);
    assert.deepEqual(r.capabilities, { list: false, switch: false });
    assert.equal('account' in r, false);
  }
});
