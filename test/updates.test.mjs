import { bootstrapAgent } from '../scripts/launch-agent.mjs';
import { exportSource } from '../scripts/export-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, cpSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { newer, versionParts, check, writeJSON, readState, status, patchState, lock, verifySource, marketplace, replaceInstallation, performUpdate, recover, run } from '../src/updates.mjs';
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'slider-update-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'cdx-slider'), home = join(base, 'updates');
  writeJSON(join(root, '.codex-plugin/plugin.json'), { name: 'cdx-slider', version: '0.1.0+codex.local' });
  return { base, root, home };
}
function source(dir, version = '0.2.0') {
  const files = { 'package.json': { version }, '.codex-plugin/plugin.json': { name: 'cdx-slider', version } };
  const manifest = {};
  for (const [path, value] of Object.entries(files)) {
    writeJSON(join(dir, path), value);
    manifest[path] = createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');
  }
  writeJSON(join(dir, 'SOURCE-MANIFEST.json'), manifest);
}
test('stable version comparisons ignore local build metadata and prevent downgrade', () => {
  assert.equal(newer('0.2.0', '0.1.0+codex.local'), true);
  assert.equal(newer('0.1.0', '0.1.0+codex.local'), false);
  assert.equal(newer('0.9.9', '1.0.0'), false);
  assert.equal(newer('1.10.0', '1.9.0'), true);
  for (const value of ['1.0.0-beta', '01.2.3', '../1.2.3', '1.2.3;rm', '9999999999999999999.0.0']) assert.throws(() => versionParts(value));
});
test('release checks handle no release, rate limits, and invalid releases without losing preferences', async t => {
  const { root, home } = fixture(t);
  patchState({ automatic: true }, home);
  let state = await check(root, { home, fetcher: async () => ({ status: 404 }) });
  assert.equal(state.status, 'no-release'); assert.equal(state.automatic, true);
  await assert.rejects(check(root, { home, fetcher: async () => ({ status: 403, ok: false }) }), /403/);
  const fetcher = release => async url => { assert.equal(url, 'https://api.github.com/repos/hwonheo/cdx-slider/releases/latest'); return { ok: true, json: async () => release }; };
  await assert.rejects(check(root, { home, fetcher: fetcher({ tag_name: 'v0.2.0', prerelease: true }) }), /stable/);
  state = await check(root, { home, fetcher: fetcher({ tag_name: 'v0.2.0' }) });
  assert.equal(state.status, 'available');
  state = await check(root, { home, fetcher: fetcher({ tag_name: 'v0.0.9' }) });
  assert.equal(state.status, 'current');
});
test('source verification rejects modified files, extra files, symlinks, and mismatched versions', t => {
  const { base } = fixture(t); const dir = join(base, 'source'); source(dir);
  verifySource(dir, '0.2.0'); assert.throws(() => verifySource(dir, '0.3.0'), /versions/);
  writeFileSync(join(dir, 'unexpected'), 'private'); assert.throws(() => verifySource(dir, '0.2.0'), /manifest/); rmSync(join(dir, 'unexpected'));
  symlinkSync('/tmp', join(dir, 'link')); assert.throws(() => verifySource(dir, '0.2.0'), /symlink/); rmSync(join(dir, 'link'));
  writeFileSync(join(dir, 'package.json'), '{}'); assert.throws(() => verifySource(dir, '0.2.0'), /checksum/);
});
test('update lock rejects a concurrent updater and can be released', t => {
  const { home } = fixture(t); const unlock = lock(home);
  assert.throws(() => lock(home), /already running/); unlock(); lock(home)();
});
test('marketplace lookup refuses another installation path', t => {
  const { root, base } = fixture(t);
  writeJSON(join(base, '.agents/plugins/marketplace.json'), { name: 'personal', plugins: [{ name: 'cdx-slider', source: { source: 'local', path: './cdx-slider' } }] });
  assert.equal(marketplace(root, base), 'cdx-slider@personal');
  assert.throws(() => marketplace(join(base, 'elsewhere'), base), /must point/);
});
test('failed activation restores old files and reactivates them', async t => {
  const { root, base } = fixture(t), prepared = join(base, 'prepared'), backup = join(base, 'backup');
  mkdirSync(prepared); writeFileSync(join(prepared, 'new'), 'new'); let calls = 0;
  await assert.rejects(replaceInstallation(root, prepared, backup, async target => {
    calls++; if (calls === 1) throw Error('install failed');
    assert.ok(existsSync(join(target, '.codex-plugin/plugin.json')));
  }), /previous installation restored/);
  assert.equal(calls, 2); assert.ok(!existsSync(join(root, 'new'))); assert.ok(!existsSync(backup));
});
test('automatic updates are opt in and retry intervals are enforced', async t => {
  const { root, home } = fixture(t);
  const forbidden = () => { throw Error('Should not check or install'); };
  await performUpdate(root, home, true, { checker: forbidden, resolveMarketplace: forbidden });
  patchState({ automatic: true, attemptedAt: Date.now() }, home);
  await performUpdate(root, home, true, { checker: forbidden, resolveMarketplace: forbidden });
});
for (const failure of [null, 'build', 'install']) test(`complete updater transaction: ${failure || 'success'}`, async t => {
  const { base, root, home } = fixture(t), input = join(base, 'release'); source(input);
  let installs = 0;
  const runner = (command, args) => {
    if (command === 'git' && args[0] === 'rev-parse') return Buffer.from('a'.repeat(40));
    if (command === 'git') cpSync(input, args.at(-1), { recursive: true });
    if (args[0] === 'scripts/build.mjs' && failure === 'build') throw Error('build failed');
    if (args[0] === 'scripts/stage-plugin.mjs') {
      writeJSON(join(args[1], '.codex-plugin/plugin.json'), { name: 'cdx-slider', version: '0.2.0' });
    }
    if (args[0] === 'plugin') { installs++; if (failure === 'install' && installs === 1) throw Error('install failed'); }
  };
  const action = performUpdate(root, home, false, { runner, platform: 'linux', resolveMarketplace: () => 'cdx-slider@personal', checker: async () => ({ status: 'available', latest: '0.2.0' }) });
  if (failure) await assert.rejects(action, /failed/); else await action;
  const version = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'))).version;
  assert.equal(version, failure ? '0.1.0+codex.local' : '0.2.0');
  assert.equal(readState(home).status, failure ? 'failed' : 'updated');
  assert.ok(!existsSync(join(home, 'lock.json'))); assert.ok(!existsSync(join(home, 'transaction.json')));
  if (failure === 'install') assert.equal(installs, 2);
});

test('interrupted replacement restores the backup without touching saved data', t => {
  const { base, root, home } = fixture(t);
  const work = join(base, '.cdx-slider-update-recovery'), backup = join(work, 'previous');
  mkdirSync(work); renameSync(root, backup);
  writeJSON(join(home, 'transaction.json'), { root, work, backup });
  const saved = join(base, 'slider.db'); writeFileSync(saved, 'saved checkpoints');
  let activated = false;
  recover(root, home, { platform: 'linux', resolveMarketplace: () => 'cdx-slider@personal', runner: () => { activated = true; } });
  assert.equal(activated, true); assert.equal(readState(home).status, 'recovered');
  assert.equal(readFileSync(saved, 'utf8'), 'saved checkpoints'); assert.ok(!existsSync(work));
});
test('a real exported release can be cloned, verified, built, and staged for the stable runtime path', async t => {
  const { base, root, home } = fixture(t), release = join(base, 'release');
  exportSource(release);
  const version = JSON.parse(readFileSync(join(release, 'package.json'))).version;
  writeJSON(join(root, '.codex-plugin/plugin.json'), { name: 'cdx-slider', version: '0.0.0' });
  run('git', ['init', '-q'], release);
  run('git', ['add', '.'], release);
  run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Create a test release'], release);
  run('git', ['-c', 'tag.gpgsign=false', 'tag', `v${version}`], release);
  let activated = false;
  const runner = (command, args, cwd, log) => {
    if (command === 'git' && args.includes('clone')) args = args.map(arg => arg === 'https://github.com/hwonheo/cdx-slider.git' ? release : arg);
    if (command === 'npm') args = [...args, '--offline'];
    if (args[0] === 'plugin') { activated = true; return; }
    return run(command, args, cwd, log);
  };
  await performUpdate(root, home, false, { runner, platform: 'linux', resolveMarketplace: () => 'cdx-slider@personal', checker: async () => ({ status: 'available', latest: version }) });
  assert.equal(activated, true); assert.equal(readState(home).status, 'updated');
  const mcp = JSON.parse(readFileSync(join(root, '.mcp.json')));
  assert.deepEqual(mcp.mcpServers['cdx-slider'].args, [join(root, 'dist/server.mjs')]);
  assert.ok(existsSync(join(root, 'dist/update-worker.mjs')));
});

test('stopped workers report failure instead of an endless updating indicator', t => {
  const { home } = fixture(t);
  patchState({ status: 'building' }, home);
  assert.equal(status(home).status, 'failed');
  patchState({ status: 'starting', scheduledAt: Date.now() }, home);
  assert.equal(status(home).status, 'starting');
  patchState({ status: 'installing' }, home);
  writeJSON(join(home, 'transaction.json'), {});
  assert.match(status(home).error, /recover/);
});

test('launchd retries transient bootstrap errors only and stops after a bounded retry count', () => {
  let attempts = 0; const waits = [];
  const success = bootstrapAgent(() => { if (++attempts < 3) throw Object.assign(Error('EIO'), { status: 5 }); return 'started'; }, 'gui/123', '/test.plist', { wait: ms => waits.push(ms) });
  assert.equal(success, 'started'); assert.deepEqual(waits, [250, 500]);
  attempts = 0;
  assert.throws(() => bootstrapAgent(() => { attempts++; throw Object.assign(Error('EIO'), { status: 5 }); }, 'gui/123', '/test.plist', { wait() {} }), /EIO/);
  assert.equal(attempts, 6);
  assert.throws(() => bootstrapAgent(() => { throw Object.assign(Error('permission'), { status: 1 }); }, 'gui/123', '/test.plist', { wait() { assert.fail('unexpected retry'); } }), /permission/);
});
