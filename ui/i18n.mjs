import { english } from './messages.mjs';

export const LANGUAGE_KEY = 'cdx-slider.language';
let language = 'en';
try { if ((typeof window === 'undefined' ? undefined : window.localStorage)?.getItem(LANGUAGE_KEY) === 'ko') language = 'ko'; } catch { /* Sandboxed hosts may block storage. */ }
const messages = new Map();
const bindings = new Map();
export const getLanguage = () => language;
export const getLocale = () => language === 'ko' ? 'ko-KR' : 'en-US';
export function t(key, values = []) {
  const template = language === 'ko' ? key : english[key] ?? key;
  const result = template.replace(/\{(\d+)\}/g, (_, index) => values[index] instanceof Date ? values[index].toLocaleString(getLocale()) : String(values[index] ?? ''));
  messages.set(result, { key, values });
  if (messages.size > 512) messages.delete(messages.keys().next().value);
  return result;
}
// Bind only application-owned text. Project names, summaries, and form values
// remain untouched when switching languages.
export function setText(element, value, literal = false) {
  const message = literal ? undefined : messages.get(value);
  if (message) bindings.set(element, message); else bindings.delete(element);
  element.textContent = message ? t(message.key, message.values) : value;
}
export function applyLanguage(root = document) {
  root.documentElement.lang = language;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
  }
  for (const [element, message] of bindings) {
    if (!element.isConnected) bindings.delete(element);
    else element.textContent = t(message.key, message.values);
  }
  const selector = root.getElementById('language');
  if (selector) { selector.value = language; selector.setAttribute('aria-label', t('언어')); }
}
export function setLanguage(next, root) {
  language = next === 'ko' ? 'ko' : 'en';
  try { (typeof window === 'undefined' ? undefined : window.localStorage)?.setItem(LANGUAGE_KEY, language); } catch { /* Keep session preference when persistence is unavailable. */ }
  if (root) applyLanguage(root);
}
