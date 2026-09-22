import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { publicDocs, publicAssets } from '../scripts/public-docs.mjs';
import { exportSource } from '../scripts/export-source.mjs';

function markdownFiles(root, relative = 'docs') {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const file = `${relative}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(root, file) : entry.name.endsWith('.md') ? [file] : [];
  }).sort();
}

function checkLocalLinks(root, files) {
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    // Public docs use inline Markdown links. Ignore fenced command examples.
    const prose = text.replace(/```[\s\S]*?```/g, '');
    for (const match of prose.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      const path = decodeURIComponent(target.split(/[?#]/)[0]);
      assert.ok(existsSync(resolve(root, dirname(file), path)), `${file}: broken link ${target}`);
    }
  }
}

test('source and plugin ship the same complete EN/KR documentation with valid local links', t => {
  const root = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), 'slider-documentation-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const source = join(temporary, 'source');
  exportSource(source);
  const plugin = join(temporary, 'cdx-slider');
  execFileSync(process.execPath, ['scripts/stage-plugin.mjs', plugin, '--without-companion']);

  const expected = [...publicDocs].sort();
  for (const destination of [source, plugin]) {
    assert.deepEqual(markdownFiles(destination), expected);
    checkLocalLinks(destination, ['README.md', 'README.ko.md', ...publicDocs]);
    for (const file of [...publicDocs, ...publicAssets]) {
      assert.deepEqual(readFileSync(join(destination, file)), readFileSync(join(root, file)));
    }
    assert.ok(!existsSync(join(destination, 'docs/assets/history')));
    assert.ok(readFileSync(join(destination, 'README.ko.md'), 'utf8').includes('(docs/assets/Installation.ko.md)'));
  }
  checkLocalLinks(root, ['README.md', 'README.ko.md', ...markdownFiles(root)]);

  // Updating an old install must not leave the previous docs alongside the new set.
  mkdirSync(join(plugin, 'docs/archive'), { recursive: true });
  writeFileSync(join(plugin, 'docs/archive/old.ko.md'), 'Historical note');
  writeFileSync(join(plugin, 'docs/connection-diagnosis.md'), 'Old installation diagnosis');
  writeFileSync(join(plugin, 'docs/assets/Development.md'), 'Private development note');
  execFileSync(process.execPath, ['scripts/stage-plugin.mjs', plugin, '--without-companion']);
  assert.deepEqual(markdownFiles(plugin), expected);
  checkLocalLinks(plugin, ['README.md', 'README.ko.md', ...publicDocs]);
});
