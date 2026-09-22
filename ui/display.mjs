import { t } from './i18n.mjs';
// Display changes never send chat messages or perform project/account actions.
export function createDisplayController(app, render) {
  const state = { mode: 'inline', supported: false, compact: false, busy: false, error: '' };
  const update = context => {
    if (context?.availableDisplayModes) state.supported = context.availableDisplayModes.includes('pip');
    if (context?.displayMode && context.displayMode !== state.mode) {
      state.mode = context.displayMode;
      state.compact = state.mode === 'pip';
    }
    render({ ...state });
  };
  async function request(mode) {
    if (state.busy || (mode === 'pip' && !state.supported)) return;
    state.busy = true; state.error = ''; render({ ...state });
    try {
      const result = await app.requestDisplayMode({ mode }, { timeout: 10000 });
      state.mode = result.mode;
      state.compact = result.mode === 'pip';
      if (result.mode !== mode) state.error = t("호스트가 화면 전환을 허용하지 않았습니다.");
    } catch {
      state.error = t("화면 전환에 실패했습니다. 다시 시도해 주세요.");
    } finally { state.busy = false; render({ ...state }); }
  }
  return {
    update,
    float: () => state.mode === 'pip' ? (state.compact = true, render({ ...state })) : request('pip'),
    expand: () => { state.compact = false; render({ ...state }); },
    inline: () => request('inline'),
  };
}
