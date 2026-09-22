import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportSource } from '../scripts/export-source.mjs';

test('source export is checksummed, excludes runtime artifacts, and never overwrites', t => {
  const parent = mkdtempSync(join(tmpdir(), 'slider-source-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const destination = join(parent, 'release');
  const manifest = exportSource(destination);
  for (const required of ['LICENSE', 'bin/cdx-slider.mjs', 'src/server.mjs', 'ui/panel.html', 'README.md', 'README.ko.md', 'package-lock.json']) {
    assert.ok(manifest[required], required);
  }
  for (const excluded of ['.local', 'dist', 'node_modules', 'src/panel.html', '.playwright-cli', 'docs/connection-diagnosis.md', 'docs/archive', 'docs/assets/history', '.git', '.github', 'docs/assets/Development.md', 'docs/assets/design-review.md', 'docs/assets/refactoring-plan.md', 'docs/assets/public-release.md', 'docs/assets/ui-design.md', 'docs/assets/ui-design.ko.md']) {
    assert.equal(existsSync(join(destination, excluded)), false, excluded);
  }
  for (const [name, hash] of Object.entries(manifest)) {
    assert.equal(createHash('sha256').update(readFileSync(join(destination, name))).digest('hex'), hash);
  }
  const saved = readFileSync(join(destination, 'SOURCE-MANIFEST.json'), 'utf8');
  assert.throws(() => exportSource(destination), /EEXIST/);
  assert.equal(readFileSync(join(destination, 'SOURCE-MANIFEST.json'), 'utf8'), saved);
});
