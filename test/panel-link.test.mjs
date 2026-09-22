import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelLinkContext } from '../ui/panel-link.mjs';

test('panel link supports host URL and query formats and never imports a task binding', () => {
  assert.equal(panelLinkContext({}), null);
  assert.deepEqual(panelLinkContext({ 'openai/deepLink': { url: '/?profile=desktop&project=demo&threadId=untrusted' } }), { profile: 'desktop', project: 'demo' });
  assert.deepEqual(panelLinkContext({ 'openai/deepLink': { path: [], query: [['profile','desktop'],['project','demo']] } }), { profile: 'desktop', project: 'demo' });
  assert.throws(() => panelLinkContext({ 'openai/deepLink': { url: '/?profile=desktop&project=../other' } }), /Invalid/);
  assert.throws(() => panelLinkContext({ 'openai/deepLink': { url: '/?profile=desktop' } }), /Invalid/);
});
