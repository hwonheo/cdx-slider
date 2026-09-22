import { bootstrapAgent } from '../scripts/launch-agent.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, openSync, closeSync, lstatSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

export const repository = 'hwonheo/cdx-slider';
export const interval = 6 * 60 * 60 * 1000;
export const updateHome = () => join(resolve(process.env.CDX_SLIDER_HOME || join(homedir(), '.local/share/cdx-slider')), 'updates');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function writeJSON(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, file);
}
export function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[A-Za-z0-9.-]+)?$/.exec(value);
  if (!match) throw Error('Only stable semantic versions are supported.');
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('Invalid version.');
  return parts;
}
export function newer(next, current) {
  const a = versionParts(next), b = versionParts(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
export function installed(root) {
  root = resolve(root);
  if (lstatSync(root).isSymbolicLink() || existsSync(join(root, '.git'))) throw Error('Update a staged plugin, not a source checkout or symlink.');
  const manifest = json(join(root, '.codex-plugin/plugin.json'));
  if (manifest.name !== 'cdx-slider') throw Error('Unrecognized plugin installation.');
  versionParts(manifest.version);
  return manifest;
}
export function readState(home = updateHome()) {
  try { return json(join(home, 'state.json')); } catch (e) { if (e.code === 'ENOENT') return { automatic: false, status: 'idle' }; throw e; }
}
export function status(home = updateHome()) {
  const state = readState(home);
  if (!['starting', 'checking', 'downloading', 'building', 'installing'].includes(state.status)) return state;
  if (existsSync(join(home, 'lock.json'))) {
    const owner = json(join(home, 'lock.json'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid update lock.');
    try { process.kill(owner.pid, 0); return state; }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  } else if (state.status === 'starting' && Date.now() - (state.scheduledAt || 0) < 30000) return state;
  return patchState({ status: 'failed', error: existsSync(join(home, 'transaction.json'))
    ? 'The update was interrupted. Run npm run update -- recover.'
    : 'The update process stopped. Check the update log and retry.' }, home);
}
export function patchState(changes, home = updateHome()) {
  const state = { ...readState(home), ...changes }; writeJSON(join(home, 'state.json'), state); return state;
}
export function lock(home = updateHome()) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, 'lock.json');
  try { const fd = openSync(file, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = json(file);
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid update lock; inspect updates/lock.json.');
    try { process.kill(owner.pid, 0); } catch (error) {
      if (error.code === 'ESRCH') { rmSync(file); return lock(home); }
      throw error;
    }
    throw Error('An update is already running.');
  }
  return () => rmSync(file, { force: true });
}
export async function check(root, { home = updateHome(), fetcher = fetch, now = Date.now() } = {}) {
  const current = installed(root).version;
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cdx-slider-updater' }, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (response.status === 404) return patchState({ checkedAt: now, current, latest: null, status: 'no-release', error: null }, home);
  if (!response.ok) throw Error(`Release check failed (HTTP ${response.status}).`);
  const release = await response.json();
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw Error('Invalid stable release.');
  const version = release.tag_name.slice(1); versionParts(version);
  return patchState({ checkedAt: now, current, latest: version, status: newer(version, current) ? 'available' : 'current', error: null }, home);
}
// Validate the entire checkout before running any downloaded build script.
export function verifySource(root, version) {
  const manifest = json(join(root, 'SOURCE-MANIFEST.json'));
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw Error('Invalid source manifest.');
  const actual = [];
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      if (!prefix && name === '.git') continue;
      const relative = prefix + name, full = join(dir, name), stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw Error(`Source symlink rejected: ${relative}`);
      if (stat.isDirectory()) walk(full, relative + '/');
      else if (stat.isFile()) actual.push(relative);
      else throw Error(`Unsupported source entry: ${relative}`);
    }
  }
  walk(root);
  const expected = Object.keys(manifest);
  for (const path of expected) {
    if (isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || path.startsWith('.git/')) throw Error('Unsafe manifest path.');
    if (!/^[a-f0-9]{64}$/.test(manifest[path])) throw Error('Invalid source checksum.');
  }
  if (JSON.stringify(actual.filter(p => p !== 'SOURCE-MANIFEST.json').sort()) !== JSON.stringify(expected.sort())) throw Error('Source manifest does not match the checkout.');
  for (const path of expected) {
    if (createHash('sha256').update(readFileSync(join(root, path))).digest('hex') !== manifest[path]) throw Error(`Source checksum mismatch: ${path}`);
  }
  if (json(join(root, 'package.json')).version !== version || json(join(root, '.codex-plugin/plugin.json')).version !== version) throw Error('Release and package versions differ.');
}
export function marketplace(root, userHome = homedir()) {
  const catalog = json(join(userHome, '.agents/plugins/marketplace.json'));
  if (!/^[A-Za-z0-9_-]+$/.test(catalog.name)) throw Error('Invalid marketplace name.');
  const entry = catalog.plugins?.find(p => p.name === 'cdx-slider');
  if (entry?.source?.source !== 'local' || typeof entry.source.path !== 'string' || resolve(userHome, entry.source.path) !== resolve(root)) throw Error('The personal marketplace must point to this staged plugin.');
  return `cdx-slider@${catalog.name}`;
}
// Whole-directory replacement preserves files belonging to the old version for rollback.
export async function replaceInstallation(root, prepared, backup, activate) {
  renameSync(root, backup);
  try {
    renameSync(prepared, root);
    await activate(root);
  } catch (error) {
    if (existsSync(root)) rmSync(root, { recursive: true });
    renameSync(backup, root);
    try { await activate(root); } catch (restore) { throw new AggregateError([error, restore], 'Update failed; old files restored but reactivation failed. Restart or reinstall the bar.'); }
    const restored = Error(`Update failed; previous installation restored: ${error.message}`);
    restored.restored = true; throw restored;
  }
}
export function run(command, args, cwd, log) {
  return execFileSync(command, args, { cwd, env: { ...process.env, PATH: `${dirname(process.execPath)}:${dirname(process.env.CDX_CODEX_BIN || '/usr/bin/codex')}:${process.env.PATH || '/usr/bin:/bin'}` }, stdio: log ? ['ignore', log, log] : 'pipe', timeout: 15 * 60 * 1000 });
}
export function launchUpdate(root, { automatic = false, home = updateHome() } = {}) {
  installed(root);
  if (existsSync(join(home, 'lock.json'))) {
    const owner = json(join(home, 'lock.json'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid update lock.');
    try { process.kill(owner.pid, 0); return readState(home); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const state = readState(home);
  if (Date.now() - (state.scheduledAt || 0) < 30000) return { ...state, status: 'starting' };
  if (automatic && (!state.automatic || Date.now() - (state.attemptedAt || 0) < interval)) return state;
  // The worker lives outside the installation it replaces and survives the bar restart.
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const worker = join(home, `worker-${randomUUID()}.mjs`);
  copyFileSync(join(root, 'dist/update-worker.mjs'), worker);
  patchState({ scheduledAt: Date.now(), status: 'starting', error: null }, home);
  try {
    if (process.platform === 'darwin') {
      // A separate launchd job survives bootout of the companion's LaunchAgent.
      const label = 'local.cdx-slider.updater', target = `gui/${process.getuid()}/${label}`;
      try { run('/bin/launchctl', ['bootout', target], home); }
      catch (error) { if (![3, 113].includes(error.status)) throw error; }
      const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      const args = [process.execPath, worker, resolve(root), home, automatic ? 'auto' : 'manual'];
      const env = { CDX_CODEX_BIN: process.env.CDX_CODEX_BIN || 'codex', PATH: `${dirname(process.execPath)}:${process.env.PATH || '/usr/bin:/bin'}` };
      if (process.env.CDX_SLIDER_HOME) env.CDX_SLIDER_HOME = process.env.CDX_SLIDER_HOME;
      const plist = join(home, 'updater.plist');
      writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(arg => `<string>${escape(arg)}</string>`).join('')}</array><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${escape(value)}</string>`).join('')}</dict><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${escape(join(home, 'update.log'))}</string><key>StandardErrorPath</key><string>${escape(join(home, 'update.log'))}</string></dict></plist>`, { mode: 0o600 });
      bootstrapAgent((...args) => run('/bin/launchctl', args, home), `gui/${process.getuid()}`, plist);
    } else {
      const log = openSync(join(home, 'update.log'), 'a', 0o600);
      const child = spawn(process.execPath, [worker, resolve(root), home, automatic ? 'auto' : 'manual'], { detached: true, stdio: ['ignore', log, log], env: process.env });
      child.on('error', error => { patchState({ status: 'failed', error: error.message }, home); rmSync(worker, { force: true }); });
      child.unref(); closeSync(log);
    }
  } catch (error) { patchState({ status: 'failed', error: error.message, scheduledAt: 0 }, home); rmSync(worker, { force: true }); throw error; }
  return { ...state, status: 'starting' };
}
export async function performUpdate(root, home = updateHome(), automatic = false, { runner = run, checker = check, resolveMarketplace = marketplace, platform = process.platform } = {}) {
  const unlock = lock(home);
  let work;
  const log = openSync(join(home, 'update.log'), 'a', 0o600);
  try {
    if (automatic && (!readState(home).automatic || Date.now() - (readState(home).attemptedAt || 0) < interval)) return;
    patchState({ attemptedAt: Date.now(), status: 'checking', error: null }, home);
    const id = resolveMarketplace(root);
    const codex = process.env.CDX_CODEX_BIN || 'codex';
    const journal = join(home, 'transaction.json');
    // A killed updater leaves a recoverable backup; never overwrite it blindly.
    if (existsSync(journal)) throw Error('An interrupted update needs recovery. Run npm run update -- recover before retrying.');
    const withCompanion = platform === 'darwin' && existsSync(join(root, 'dist/CDX Slider.app'));
    const state = await checker(root, { home });
    if (state.status !== 'available') return;
    work = mkdtempSync(join(dirname(root), '.cdx-slider-update-'));
    const source = join(work, 'source'), prepared = join(work, 'cdx-slider'), backup = join(work, 'previous');
    patchState({ status: 'downloading' }, home);
    runner('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth=1', '--branch', `v${state.latest}`, '--single-branch', `https://github.com/${repository}.git`, source], work, log);
    const head = runner('git', ['rev-parse', 'HEAD'], source).toString().trim();
    const tag = runner('git', ['rev-parse', `refs/tags/v${state.latest}^{commit}`], source).toString().trim();
    if (!/^[a-f0-9]{40,64}$/.test(head) || head !== tag) throw Error('Checkout does not match the release tag.');
    verifySource(source, state.latest);
    patchState({ status: 'building' }, home);
    runner('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source, log);
    runner(process.execPath, ['scripts/build.mjs'], source, log);
    runner(process.execPath, ['scripts/stage-plugin.mjs', prepared, '--prepare-only', '--runtime-root', root, ...(withCompanion ? [] : ['--without-companion'])], source, log);
    writeJSON(journal, { root, work, backup, prepared, codex, id });
    patchState({ status: 'installing' }, home);
    const activate = target => {
      runner(codex, ['plugin', 'add', id], target, log);
      if (withCompanion) runner(process.execPath, [join(target, 'dist/install-companion.mjs'), '--app', join(target, 'dist/CDX Slider.app')], target, log);
    };
    await replaceInstallation(root, prepared, backup, activate);
    rmSync(journal);
    patchState({ status: 'updated', current: state.latest, error: null, restartRequired: true, updatedAt: Date.now() }, home);
  } catch (error) {
    if (error.restored) rmSync(join(home, 'transaction.json'), { force: true });
    patchState({ status: 'failed', error: error.message }, home); throw error;
  } finally {
    // Preserve recovery data on failure, including failures during reactivation.
    if (work && !existsSync(join(home, 'transaction.json'))) rmSync(work, { recursive: true, force: true });
    closeSync(log); unlock();
  }
}
export function recover(root, home = updateHome(), { runner = run, resolveMarketplace = marketplace, platform = process.platform } = {}) {
  const unlock = lock(home);
  try {
    const file = join(home, 'transaction.json'), tx = json(file);
    if (tx.root !== resolve(root) || dirname(tx.work) !== dirname(resolve(root)) || !tx.work.startsWith(join(dirname(root), '.cdx-slider-update-')) || tx.backup !== join(tx.work, 'previous')) throw Error('Invalid recovery record.');
    if (existsSync(tx.backup)) {
      installed(tx.backup);
      if (existsSync(root)) { installed(root); rmSync(root, { recursive: true }); }
      renameSync(tx.backup, root);
    }
    installed(root);
    const id = resolveMarketplace(root), codex = process.env.CDX_CODEX_BIN || 'codex';
    runner(codex, ['plugin', 'add', id], root);
    if (platform === 'darwin' && existsSync(join(root, 'dist/CDX Slider.app'))) runner(process.execPath, [join(root, 'dist/install-companion.mjs'), '--app', join(root, 'dist/CDX Slider.app')], root);
    rmSync(file); rmSync(tx.work, { recursive: true, force: true });
    return patchState({ status: 'recovered', current: installed(root).version, restartRequired: true, error: null }, home);
  } finally { unlock(); }
}
