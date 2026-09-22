import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { schemas } from '../src/schemas.mjs';

test('real MCP client saves in profile A then restores from a fresh server in profile B', async t => {
  const root = mkdtempSync(join(tmpdir(), 'slider-mcp-'));
  const project = join(root, 'project');
  mkdirSync(project);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const connect = async codexHome => {
    const client = new Client({ name: 'slider-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [resolve(process.env.SLIDER_TEST_SERVER || 'src/server.mjs')],
      env: { PATH: process.env.PATH, CDX_SLIDER_HOME: join(root, 'data'), CODEX_HOME: codexHome }, stderr: 'pipe' });
    await client.connect(transport);
    return client;
  };
  const call = async (client, name, args) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    return r.structuredContent;
  };
  const a = await connect(join(root, 'account-a'));
  try {
    assert.equal((await a.listTools()).tools.length, Object.keys(schemas).length);
    await call(a, 'profile_register', { id: 'a', label: 'First account' });
    await call(a, 'profile_register', { id: 'b', label: 'Second workspace' });
    await call(a, 'project_register', { project: 'demo', profile: 'a', path: project, name: 'Demo' });
    const panel = await call(a, 'slider_panel', { profile: 'a', currentPath: project });
    assert.equal(panel.selectedProject, 'demo');
    assert.equal(panel.hostUiAdvertised, false);
    const tools = await a.listTools();
    const homeTool = tools.tools.find(t => t.name === 'slider_home');
    assert.deepEqual(homeTool._meta['openai/ui'].entrypoints, [{ type: 'global' }]);
    const home = await call(a, 'slider_home', { profile: 'a', project: 'demo' });
    assert.equal(home.standalone, true);
    assert.equal(home.relay, null);
    const homeResource = await a.readResource({ uri: homeTool._meta.ui.resourceUri });
    assert.match(homeResource.contents[0].text, /data-slider-standalone="true"/);
    const uri = tools.tools.find(t => t.name === 'slider_panel')._meta.ui.resourceUri;
    const resource = await a.readResource({ uri });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(resource.contents[0].text, /현재 대화 저장/);
    await call(a, 'memory_put', { project: 'demo', profile: 'a', key: 'language', content: '한국어로 소통한다.' });
    await call(a, 'checkpoint_save', { project: 'demo', profile: 'a', goal: '연속성 검증', summary: '저장 완료', nextSteps: ['전환 후 복원'] });
    const denied = await a.callTool({ name: 'project_resume', arguments: { project: 'demo', profile: 'b' } });
    assert.equal(denied.isError, true);
    await call(a, 'project_grant', { project: 'demo', profile: 'a', targetProfile: 'b' });
  } finally { await a.close(); }
  const b = await connect(join(root, 'account-b'));
  try {
    const restored = await call(b, 'project_resume', { project: 'demo', profile: 'b' });
    assert.equal(restored.checkpoint.summary, '저장 완료');
    assert.equal(restored.memories[0].content, '한국어로 소통한다.');
    assert.deepEqual(restored.checkpoint.nextSteps, ['전환 후 복원']);
    const exported = await call(b, 'handoff_export', { project: 'demo', profile: 'b' });
    assert.match(exported.content, /연속성 검증/);
  } finally { await b.close(); }
});
