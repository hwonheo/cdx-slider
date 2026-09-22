import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('documented CLI workflow persists across processes and never overwrites an export', t => {
  const dir = mkdtempSync(join(tmpdir(), 'slider-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = resolve('bin/cdx-slider.mjs');
  const env = { ...process.env, CDX_SLIDER_HOME: join(dir, 'data') };
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' }));
  run('profile', 'add', 'a', 'Account A');
  run('profile', 'add', 'b', 'Account B');
  run('project', 'add', 'demo', 'a', dir, 'Demo');
  run('checkpoint', 'save', 'demo', 'a', resolve('examples/checkpoint.json'));
  run('project', 'grant', 'demo', 'a', 'b');
  assert.equal(run('resume', 'demo', 'b').checkpoint.summary, 'Registered the project and prepared its first checkpoint.');
  const file = join(dir, 'handoff.md');
  run('export', 'demo', 'b', file);
  const original = readFileSync(file, 'utf8');
  const duplicate = spawnSync(process.execPath, [cli, 'export', 'demo', 'b', file], { env });
  assert.equal(duplicate.status, 1);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(run('usage', 'a').profiles[0].status, 'unavailable');
});
