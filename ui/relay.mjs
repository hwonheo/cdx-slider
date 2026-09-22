import { t } from './i18n.mjs';
import { requestConversationAction } from './actions.mjs';

// Do not retry delivery when sendMessage/ack times out. The host might already
// have accepted the user message. Only the next explicit click can retry.
export async function relayTick({ bridge, tool, channel, isCurrent, report }) {
  const { token, profile, project } = channel;
  const { request } = await tool('relay_poll', { token, profile, project });
  if (!request) return;
  let status = 'rejected';
  if (isCurrent()) {
    try {
      await requestConversationAction(bridge, 'resume', profile, project);
      status = 'accepted';
    } catch { status = 'unknown'; }
  }
  await tool('relay_ack', { token, requestId: request.id, status });
  report(status === 'accepted' ? t("불러오기 요청을 대화에 전달했습니다. 모델의 답변을 확인하세요.") : t("전달 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다."));
}
