import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { schemas } from '../src/schemas.mjs';

test('staged MCP config launches literally from another working directory', async t => {
  const root = mkdtempSync(join(tmpdir(), 'slider-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'cdx-slider');
  execFileSync(process.execPath, ['scripts/stage-plugin.mjs', target, '--without-companion']);
  assert.equal(readFileSync(join(target, 'dist/THIRD-PARTY-NOTICES.txt'), 'utf8'), readFileSync('dist/THIRD-PARTY-NOTICES.txt', 'utf8'));
  const config = JSON.parse(readFileSync(join(target, '.mcp.json'), 'utf8')).mcpServers['cdx-slider'];
  const client = new Client({ name: 'installation-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ ...config, cwd: root,
      env: { PATH: process.env.PATH, CDX_SLIDER_HOME: join(root, 'data') }, stderr: 'pipe' }));
    assert.equal((await client.listTools()).tools.length, Object.keys(schemas).length);
    const resource = await client.readResource({ uri: 'ui://cdx-slider/panel.html' });
    assert.match(resource.contents[0].text, /현재 대화 저장/);
    const r = await client.callTool({ name: 'profiles_list', arguments: {} });
    assert.equal(r.isError, undefined);
    assert.deepEqual(r.structuredContent.profiles, []);
  } finally { await client.close(); }
});

test('MCP stays connected when the data directory is unavailable', async t => {
  const root = mkdtempSync(join(tmpdir(), 'slider-unavailable-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const blocked = join(root, 'not-a-directory');
  writeFileSync(blocked, 'file');
  const client = new Client({ name: 'storage-error-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [resolve(process.env.SLIDER_TEST_SERVER || 'src/server.mjs')],
      env: { PATH: process.env.PATH, CDX_SLIDER_HOME: blocked }, stderr: 'pipe' }));
    assert.equal((await client.listTools()).tools.length, Object.keys(schemas).length);
    assert.equal((await client.callTool({ name: 'profiles_list', arguments: {} })).isError, true);
    assert.equal((await client.listTools()).tools.length, Object.keys(schemas).length);
  } finally { await client.close(); }
});
