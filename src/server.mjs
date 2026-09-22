import { restartController } from './restart.mjs';
import { loginController } from './login.mjs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from './store.mjs';
import { schemas } from './schemas.mjs';
import { execute, descriptions } from './service.mjs';
import { registerAppResource, RESOURCE_MIME_TYPE, getUiCapability } from '@modelcontextprotocol/ext-apps/server';
import { readFileSync } from 'node:fs';

const panelUri = 'ui://cdx-slider/panel.html';
const homeUri = 'ui://cdx-slider/home.html';

// Storage access is a tool operation, not a prerequisite for MCP discovery.
let store;
const server = new McpServer({ name: 'cdx-slider', version: '0.1.0' });
const readOnly = new Set(['profiles_list', 'projects_list', 'project_resume', 'handoff_export', 'usage_read', 'account_read', 'workspace_read', 'login_status', 'restart_status']);
for (const uri of [panelUri, homeUri]) registerAppResource(server, uri === homeUri ? 'CDX Slider controls' : 'CDX Slider panel', uri, {
  _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
}, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE,
  text: readFileSync(new URL('./panel.html', import.meta.url), 'utf8').replace('<html lang="en">', uri === homeUri ? '<html lang="en" data-slider-standalone="true">' : '<html lang="en">'),
  _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
    'openai/widgetDescription': 'CDX Slider controls for project registration and requesting a checkpoint save or restore in the current conversation.' },
}] }));
for (const [name, schema] of Object.entries(schemas)) {
  server.registerTool(name, {
    description: descriptions[name], inputSchema: schema,
    _meta: ['slider_panel', 'slider_home'].includes(name)
      ? { ui: { resourceUri: name === 'slider_home' ? homeUri : panelUri, visibility: ['model', 'app'] }, 'openai/outputTemplate': name === 'slider_home' ? homeUri : panelUri,
          ...(name === 'slider_home' ? { 'openai/ui': { entrypoints: [{ type: 'global' }] } } : {}) }
      : { ui: { visibility: name.startsWith('relay_') ? ['app'] : ['model', 'app'] }, 'openai/widgetAccessible': true },
    annotations: { readOnlyHint: readOnly.has(name), destructiveHint: ['memory_put','restart_schedule'].includes(name),
      idempotentHint: readOnly.has(name) || name === 'project_grant', openWorldHint: ['usage_read', 'account_read', 'workspace_read', 'login_start', 'login_cancel'].includes(name) },
  }, async input => {
    try {
      store ??= new Store();
      const result = await execute(store, name, input);
      if (['slider_panel', 'slider_home'].includes(name)) {
        result.hostUiAdvertised = !!getUiCapability(server.server.getClientCapabilities())?.mimeTypes?.includes(RESOURCE_MIME_TYPE);
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  restartController.close();
  loginController.close();
  await server.close();
  store?.close();
}
process.once('SIGTERM', () => close().then(() => process.exit(0)));
process.once('SIGINT', () => close().then(() => process.exit(0)));
await server.connect(new StdioServerTransport());
