import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { thirdPartyNotices, noticesTemplate } from '../scripts/third-party-notices.mjs';

test('notices retain license and NOTICE text for transitive inputs and fail on missing licenses', t => {
  const root = mkdtempSync(join(tmpdir(), 'slider-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'node_modules', 'dependency');
  mkdirSync(join(pkg, 'nested'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'dependency', version: '1.0.0' }));
  const meta = { inputs: { 'node_modules/dependency/nested/index.js': {}, 'node_modules/dependency/other.js': {} } };
  assert.throws(() => thirdPartyNotices([meta], root), /Missing license/);
  writeFileSync(join(pkg, 'LICENSE'), 'Original copyright and permission text');
  writeFileSync(join(pkg, 'NOTICE'), 'Original attribution <script> & </template>');
  const text = thirdPartyNotices([meta, meta], root);
  assert.equal(text.match(/## dependency@1.0.0/g).length, 1);
  assert.ok(text.includes('Original copyright and permission text'));
  assert.ok(text.includes('Original attribution <script> & </template>'));
  assert.ok(!text.includes(root));
  const html = noticesTemplate(text);
  assert.ok(html.includes('&lt;script&gt; &amp; &lt;/template&gt;'));
});

test('real distributions retain upstream Zod copyright and standalone panel notices', () => {
  const notices = readFileSync('dist/THIRD-PARTY-NOTICES.txt', 'utf8');
  assert.ok(notices.includes(readFileSync('node_modules/zod/LICENSE', 'utf8')));
  assert.ok(notices.includes(readFileSync('node_modules/@modelcontextprotocol/sdk/LICENSE', 'utf8')));
  const panel = readFileSync('dist/panel.html', 'utf8');
  assert.ok(panel.includes('id="third-party-notices"'));
  assert.ok(panel.includes('Colin McDonnell'));
  assert.ok(panel.includes('@modelcontextprotocol/ext-apps@'));
});
