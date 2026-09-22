import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { english } from '../ui/messages.mjs';
import { t, setLanguage, getLanguage, getLocale, setText, applyLanguage, LANGUAGE_KEY } from '../ui/i18n.mjs';
import { conversationRequest } from '../ui/actions.mjs';

function root() {
  return { documentElement: {}, querySelectorAll: () => [], getElementById: () => null };
}

test('English is default, Korean is optional, and both host prompts preserve action constraints', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(getLocale(), 'en-US');
  assert.match(conversationRequest('save', 'desktop', 'demo'), /only after checkpoint_save succeeds/);
  setLanguage('ko');
  assert.equal(getLocale(), 'ko-KR');
  assert.match(conversationRequest('save', 'desktop', 'demo'), /checkpoint_save가 성공한 뒤에만/);
  assert.match(conversationRequest('resume', 'desktop', 'demo'), /추가 구현이나 파일 수정은 하지 마/);
  setLanguage('en');
  assert.match(conversationRequest('resume', 'desktop', 'demo'), /Do not implement changes or edit files/);
});

test('language switching updates bound status and date text without translating user content', () => {
  const status = { isConnected: true }, userContent = { isConnected: true }, date = { isConnected: true };
  const when = new Date('2026-01-02T03:04:05Z');
  const view = root();
  setText(status, t('연결 실패'));
  setText(userContent, 'Connection failed', true);
  setText(date, t('마지막 확인: {0}', [when]));
  setLanguage('ko', view);
  assert.equal(view.documentElement.lang, 'ko');
  assert.equal(status.textContent, '연결 실패');
  assert.equal(userContent.textContent, 'Connection failed');
  assert.equal(date.textContent, `마지막 확인: ${when.toLocaleString('ko-KR')}`);
  setLanguage('en', view);
  assert.equal(status.textContent, 'Connection failed');
  assert.equal(date.textContent, `Last checked: ${when.toLocaleString('en-US')}`);
});

test('preference persists and blocked browser storage does not break language selection', async () => {
  const previous = globalThis.window;
  try {
    const values = new Map();
    globalThis.window = { localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } };
    setLanguage('ko');
    assert.equal(values.get(LANGUAGE_KEY), 'ko');
    const restored = await import('../ui/i18n.mjs?restored-language-test');
    assert.equal(restored.getLanguage(), 'ko');
    globalThis.window = Object.defineProperty({}, 'localStorage', { get() { throw new Error('Access denied'); } });
    const blocked = await import('../ui/i18n.mjs?blocked-storage-test');
    assert.equal(blocked.getLanguage(), 'en');
    assert.doesNotThrow(() => blocked.setLanguage('ko', root()));
    assert.equal(blocked.getLanguage(), 'ko');
    setLanguage('unexpected');
    assert.equal(getLanguage(), 'en');
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('initial markup exposes English and explicit restart consent', () => {
  const html = readFileSync(new URL('../ui/panel.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<option value="en">EN<\/option><option value="ko">KR<\/option>/);
  assert.doesNotMatch(html, /id="restart-(?:saved|auto)"[^>]*checked/);
});

test('every Korean UI translation key has an English default', () => {
  const directory = new URL('../ui/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => /\.(mjs|html)$/.test(file) && file !== 'messages.mjs')) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    const keys = [...source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g)]
      .map(match => match[2].replaceAll('\\n', '\n'));
    keys.push(...[...source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(match => match[1]));
    for (const key of keys.filter(key => /[가-힣]/.test(key))) {
      assert.ok(Object.hasOwn(english, key), `${file}: missing English translation for ${key}`);
      assert.doesNotMatch(english[key], /[가-힣]/, `${file}: Korean text in English translation`);
    }
  }
});
