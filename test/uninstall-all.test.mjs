import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uninstallAll } from '../scripts/uninstall-all.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'slider-uninstall-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'checkout');
  const staged = join(home, 'plugins/cdx-slider');
  const dataHome = join(home, '.local/share/cdx-slider');
  for (const path of [join(staged, '.codex-plugin'), join(root, 'dist/CDX Slider.app'), dataHome]) mkdirSync(path, { recursive: true });
  writeFileSync(join(staged, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'cdx-slider' }));
  writeFileSync(join(dataHome, 'slider.db'), 'saved');
  return { home, root, staged, dataHome, platform: 'darwin', uid: 123, log() {} };
}

test('combined removal stops the bar before removing files and preserves source and saved data', t => {
  const f = fixture(t), calls = [];
  uninstallAll({ ...f, exec(command, args) { calls.push([command, args]); return ''; } });
  assert.equal(calls[0][0], '/bin/launchctl');
  assert.equal(calls[1][0], '/usr/bin/osascript');
  assert.deepEqual(calls[3][1], ['plugin', 'remove', 'cdx-slider@personal']);
  assert.equal(existsSync(f.staged), false);
  assert.equal(existsSync(join(f.root, 'dist/CDX Slider.app')), false);
  assert.equal(calls[2][1][1], 'gui/123/local.cdx-slider.updater');
  assert.ok(existsSync(f.root));
  assert.ok(existsSync(join(f.dataHome, 'slider.db')));
});

test('preview does not execute commands or delete files', t => {
  const f = fixture(t);
  uninstallAll({ ...f, dryRun: true, exec() { assert.fail('command executed'); }, remove() { assert.fail('file deleted'); } });
  assert.ok(existsSync(f.staged));
});

test('failed plugin removal keeps app files; unexpected launch errors stop removal', t => {
  const f = fixture(t);
  assert.throws(() => uninstallAll({ ...f, exec(command, args) {
    if (args[0] === 'plugin') throw Error('remove failed');
    return '';
  } }), /remove failed/);
  assert.ok(existsSync(f.staged));
  assert.throws(() => uninstallAll({ ...f, exec() { throw Object.assign(Error('denied'), { status: 1 }); } }), /denied/);
  assert.ok(existsSync(f.staged));
});

test('checkout and overlapping saved data are rejected before any command', t => {
  const f = fixture(t);
  const exec = () => assert.fail('command executed');
  assert.throws(() => uninstallAll({ ...f, dataHome: join(f.staged, 'data'), exec }), /overlaps/);
  mkdirSync(join(f.staged, '.git'));
  assert.throws(() => uninstallAll({ ...f, exec }), /checkout/);
});

test('removal refuses to race with a running updater or interrupted replacement', t => {
  const f = fixture(t), updates = join(f.dataHome, 'updates');
  mkdirSync(updates);
  const exec = () => assert.fail('command executed');
  writeFileSync(join(updates, 'lock.json'), JSON.stringify({ pid: process.pid }));
  assert.throws(() => uninstallAll({ ...f, exec }), /update is running/);
  rmSync(join(updates, 'lock.json'));
  writeFileSync(join(updates, 'transaction.json'), '{}');
  assert.throws(() => uninstallAll({ ...f, exec }), /Recover/);
  assert.ok(existsSync(f.staged));
});
