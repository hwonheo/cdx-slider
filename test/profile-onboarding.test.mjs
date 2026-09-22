import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/store.mjs';
import { panelLinkContext } from '../ui/panel-link.mjs';
import { execute } from '../src/service.mjs';

// Exercise the actual panel handlers against a fresh real store, with a minimal
// host/DOM adapter. Account, login and restart services are intentionally mocked.
async function panel(t, { tools = true, standalone = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'slider-onboarding-'));
  const store = new Store(home);
  t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }); });
  const html = readFileSync(new URL('../ui/panel.html', import.meta.url), 'utf8');
  const elements = new Map();
  const element = () => ({ value: '', hidden: false, disabled: false, children: [], elements: [], handlers: {},
    classList: { toggle() {} }, addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute() {}, focus() {}, append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }, closest() { return null; } });
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element());
  const $ = id => { assert.ok(elements.has(id), `Missing markup: ${id}`); return elements.get(id); };
  for (const id of ['profile-register-form', 'register-form']) {
    $(id).hidden = true;
    $(id).elements = [element()];
  }
  const calls = [];
  let app;
  class App {
    constructor() { app = this; }
    getHostCapabilities() { return { ...(tools ? { serverTools: {} } : {}), message: { text: {} } }; }
    getHostContext() { return {}; }
    async connect() {
      this.ontoolresult({ structuredContent: await execute(store, standalone ? 'slider_home' : 'slider_panel', standalone ? {} : { currentPath: home }) });
    }
    async callServerTool({ name, arguments: args }) {
      calls.push(name);
      if (['account_read', 'workspace_read', 'login_status', 'restart_status'].includes(name)) return { structuredContent: { status: 'idle' } };
      try { return { structuredContent: await execute(store, name, args) }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    }
  }
  const source = readFileSync(new URL('../ui/panel.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  await runInNewContext(`(async () => { ${source} })()`, {
    App, panelLinkContext, document: { getElementById: $, createElement: element, querySelectorAll: () => [], body: element() },
    window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {},
    applyLanguage() {}, applyHostStyleVariables() {}, applyHostFonts() {},
    createDisplayController: () => ({ update() {} }),
    t: x => x, getLanguage: () => 'en', getLocale: () => 'en-US',
    setText: (el, text) => { el.textContent = text; },
  });
  // options() creates option elements, including inside later event handlers.
  return { $, store, home, calls, app };
}

async function fire(el, event) {
  el.handlers[event]({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
}

test('first install can create/select a profile then register/select a project without reopening', async t => {
  const { $, store, home } = await panel(t);
  assert.equal(store.profiles().length, 0);
  assert.equal($('profile-empty').hidden, false);
  assert.equal($('profile-register-form').hidden, false);
  assert.equal($('profile-register-form').elements[0].disabled, false);
  assert.equal($('register-toggle').disabled, true);
  $('profile-id').value = 'desktop'; $('profile-label').value = 'My work';
  await fire($('profile-register-form'), 'submit');
  assert.equal($('profile').value, 'desktop');
  assert.equal($('profile-empty').hidden, true);
  assert.equal($('profile-register-form').hidden, true);
  assert.equal($('register-form').hidden, false);
  assert.equal($('register-toggle').disabled, false);
  assert.equal(store.profile('desktop').codex_home, null);
  $('project-id').value = 'demo'; $('project-name').value = 'Demo'; $('project-path').value = home;
  await fire($('register-form'), 'submit');
  assert.equal($('project').value, 'demo');
  assert.equal($('save').disabled, false);
  assert.equal(store.projects('desktop')[0].id, 'demo');
});

test('failed or duplicate registration leaves form recoverable and selection unchanged', async t => {
  const { $, store } = await panel(t);
  $('profile-id').value = 'invalid/id'; $('profile-label').value = 'My work';
  await fire($('profile-register-form'), 'submit');
  assert.equal(store.profiles().length, 0);
  assert.equal($('profile').value, '');
  assert.equal($('profile-register-form').hidden, false);
  assert.equal($('profile-register-form').elements[0].disabled, false);
  $('profile-id').value = 'desktop';
  await fire($('profile-register-form'), 'submit');
  await fire($('profile-register-toggle'), 'click');
  await fire($('profile-register-form'), 'submit');
  assert.equal(store.profiles().length, 1);
  assert.equal($('profile').value, 'desktop');
  assert.equal($('profile-register-form').hidden, false);
  assert.match($('status').textContent, /already exists/);
});

test('host without server tools cannot create a profile', async t => {
  const { $, calls } = await panel(t, { tools: false });
  assert.equal($('profile-register-toggle').disabled, true);
  assert.equal($('profile-register-form').elements[0].disabled, true);
  assert.equal(calls.length, 0);
});


test('standalone panel never enables conversation actions even if host advertises messaging', async t => {
 const { $, store, app } = await panel(t, { standalone: true });
 await execute(store, 'profile_register', { id: 'desktop', label: 'Desktop' });
 await app.ontoolresult({ structuredContent: await execute(store, 'slider_home', { profile: 'desktop' }) });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal($('save').disabled,true);
 assert.equal($('resume').disabled,true);
 assert.equal($('connection').textContent,'독립 패널');
 assert.equal($('profile-register-toggle').disabled,false);
});
