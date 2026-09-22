import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function normalizeLimits(value = {}) {
  const sources = value.rateLimitsByLimitId && Object.keys(value.rateLimitsByLimitId).length
    ? Object.entries(value.rateLimitsByLimitId)
    : value.rateLimits ? [[value.rateLimits.limitId || 'codex', value.rateLimits]] : [];
  const window = w => w ? {
    usedPercent: Number.isFinite(w.usedPercent) ? w.usedPercent : null,
    remainingPercent: Number.isFinite(w.usedPercent) ? Math.max(0, Math.min(100, 100 - w.usedPercent)) : null,
    windowDurationMins: Number.isFinite(w.windowDurationMins) ? w.windowDurationMins : null,
    resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt : null,
  } : null;
  return sources.map(([id, v]) => ({ id, name: v.limitName || id, primary: window(v.primary), secondary: window(v.secondary) }));
}

// Read-only RPCs. Never perform a model turn, login, logout, or reset-credit consumption.
export async function readUsage(profile, { command = process.env.CDX_CODEX_BIN || 'codex', timeoutMs = 12000, accountOnly = false } = {}) {
  const base = { profile: profile.id, label: profile.label, checkedAt: new Date().toISOString() };
  if (!profile.codex_home) return { ...base, status: 'unavailable', reason: 'No Codex home registered. For the active desktop account use the native usage tool; a label alone cannot select its credentials.', limits: [] };
  return new Promise(resolve => {
    const env = { ...process.env, CODEX_HOME: profile.codex_home };
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID']) delete env[key];
    const child = spawn(command, ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let done = false;
    let account;
    let rawLimits;
    let limitError = false;
    let receivedLimits = false;
    let bytes = 0;
    const finish = extra => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reader.close();
      child.stdin.destroy();
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 300);
      killTimer.unref();
      resolve({ ...base, limits: [], ...extra });
    };
    const timer = setTimeout(() => finish({ status: 'timeout', reason: 'Usage request timed out.' }), timeoutMs);
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    // Drain stderr without exposing login tokens, paths, or raw backend diagnostics.
    child.stderr.resume();
    child.stdout.on('data', b => { bytes += b.length; if (bytes > 2 * 1024 * 1024) finish({ status: 'error', reason: 'Unexpectedly large RPC response.' }); });
    child.on('error', () => finish({ status: 'error', reason: 'Unable to start Codex. Check CDX_CODEX_BIN or PATH.' }));
    child.stdin.on('error', () => finish({ status: 'error', reason: 'Codex RPC input closed.' }));
    child.on('exit', () => { if (!done) finish({ status: 'error', reason: 'Codex exited before replying.' }); });
    const send = message => { if (!done) child.stdin.write(JSON.stringify(message) + '\n'); };
    const maybeFinish = () => {
      if (account === undefined || !receivedLimits) return;
      if (!account) return finish({ status: 'signed_out', reason: 'This profile is not signed in.' });
      const identity = { type: account.type, email: account.email ?? null, planType: account.planType ?? null };
      const limits = normalizeLimits(rawLimits);
      finish({ status: !limitError && limits.length ? 'ok' : 'unavailable', account: identity, limits, workspaceId: !limitError && typeof rawLimits?.accountId === 'string' && rawLimits.accountId.trim() ? rawLimits.accountId.trim() : null,
        ...(limitError ? { reason: 'Account is available, but its usage could not be read.' } : {}) });
    };
    reader.on('line', line => {
      if (done) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return finish({ status: 'error', reason: 'Invalid RPC output.' }); }
      if (msg.id === 1) {
        if (msg.error) return finish({ status: 'error', reason: 'Codex initialize failed.' });
        send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        send({ jsonrpc: '2.0', id: 2, method: 'account/read', params: { refreshToken: false } });
        if (!accountOnly) send({ jsonrpc: '2.0', id: 3, method: 'account/rateLimits/read', params: {} });
      } else if (msg.id === 2) {
        if (msg.error) return finish({ status: 'error', reason: 'Account could not be read.' });
        account = msg.result?.account ?? null;
        if (!account) return finish({ status: 'signed_out', reason: 'This profile is not signed in.' });
        if (accountOnly) return finish({ status: 'ok', account: { type: account.type, email: account.email ?? null, planType: account.planType ?? null } });
        maybeFinish();
      } else if (msg.id === 3) {
        rawLimits = msg.result ?? {};
        limitError = !!msg.error;
        receivedLimits = true;
        maybeFinish();
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'cdx-slider', title: 'CDX Slider', version: '0.1.0' } } });
  });
}

// Current process credentials are independent of shared storage profile labels.
export async function readCurrentAccount({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), ...options } = {}) {
  const result = await readUsage({ id: 'local', label: 'Local Codex', codex_home: codexHome }, { ...options, accountOnly: true });
  const { profile, label, limits, ...account } = result;
  return { ...account, source: 'local-codex', desktopAccountVerified: false, workspace: null };
}

export async function readCurrentWorkspace({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), ...options } = {}) {
  const result = await readUsage({ id: 'local', label: 'Local Codex', codex_home: codexHome }, options);
  return {
    status: result.workspaceId ? 'ok' : result.status === 'ok' ? 'unavailable' : result.status,
    checkedAt: result.checkedAt,
    workspace: result.workspaceId ? { id: result.workspaceId, name: null } : null,
    source: 'local-codex-usage-account', desktopAccountVerified: false,
    capabilities: { list: false, switch: false },
    reason: result.workspaceId ? null : 'The current local Codex response did not include a workspace ID.',
  };
}
