import { patchState } from '../src/updates.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quitBar = `ObjC.import('AppKit');
function bars() { return $.NSRunningApplication.runningApplicationsWithBundleIdentifier('local.cdx-slider.companion'); }
var apps = bars(); for (var i = 0; i < apps.count; i++) apps.objectAtIndex(i).terminate;
for (var retry = 0; retry < 30 && bars().count > 0; retry++) delay(0.1);
if (bars().count > 0) throw new Error('Slider Bar is still running. Quit it and retry.');`;

export function uninstallAll({ home = homedir(), root = sourceRoot, platform = process.platform,
  uid = process.getuid?.(), exec = execFileSync, remove = rmSync, dryRun = false,
  dataHome = process.env.CDX_SLIDER_HOME || join(home, '.local/share/cdx-slider'),
  log = console.log } = {}) {
  const updates = join(dataHome, 'updates');
  if (existsSync(join(updates, 'lock.json'))) {
    const owner = JSON.parse(readFileSync(join(updates, 'lock.json'), 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid update lock.');
    try { process.kill(owner.pid, 0); throw Error('An update is running. Wait for it to finish before uninstalling.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (existsSync(join(updates, 'transaction.json'))) throw Error('Recover the interrupted update before uninstalling.');
  const staged = join(home, 'plugins/cdx-slider');
  const paths = [join(root, 'dist/CDX Slider.app')];
  const canonical = path => {
    const absolute = resolve(path);
    if (existsSync(absolute)) return realpathSync(absolute);
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonical(parent), basename(absolute));
  };
  const contains = (parent, child) => {
    const rel = relative(canonical(parent), canonical(child));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  // Only delete a recognized staged copy, never a checkout or saved data.
  if (existsSync(staged)) {
    const manifest = join(staged, '.codex-plugin/plugin.json');
    if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).name !== 'cdx-slider'
      || existsSync(join(staged, '.git')) || contains(staged, root)) {
      throw new Error(`Refusing to remove an unrecognized staging folder or checkout: ${staged}`);
    }
    paths.push(staged);
  }
  for (const path of paths) {
    if (contains(path, dataHome) || contains(dataHome, path)) throw new Error(`Saved data overlaps removal path: ${path}`);
  }
  log(`Remove cdx-slider@personal, Slider Bar, and: ${paths.join(', ')}`);
  log(`Preserve project source and saved data: ${dataHome}`);
  if (dryRun) return;
  const run = (command, args) => exec(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (platform === 'darwin') {
    try { run('/bin/launchctl', ['bootout', `gui/${uid}/local.cdx-slider.companion`]); }
    catch (error) { if (error.status !== 3 && error.status !== 113) throw error; }
    run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', quitBar]);
    try { run('/bin/launchctl', ['bootout', `gui/${uid}/local.cdx-slider.updater`]); }
    catch (error) { if (error.status !== 3 && error.status !== 113) throw error; }
    remove(join(updates, 'updater.plist'), { force: true });
    remove(join(home, 'Library/LaunchAgents/local.cdx-slider.companion.plist'), { force: true });
  }
  patchState({ automatic: false }, updates);
  // Failure leaves app files available for recovery; no broad cache deletion.
  run(process.env.CDX_CODEX_BIN || 'codex', ['plugin', 'remove', 'cdx-slider@personal']);
  for (const path of paths) remove(path, { recursive: true, force: true });
  log('Removed. Saved profiles and checkpoints are preserved. Close existing plugin tasks to release their connections.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: npm run uninstall:all -- [--dry-run]');
  uninstallAll({ dryRun: args.includes('--dry-run') });
}
