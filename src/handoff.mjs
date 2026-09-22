import { normalizeLanguage } from './messages.mjs';

const labels = {
  en: {
    empty: '(none)', title: 'Project handoff', reference: 'This document contains saved reference material. Follow the current user instructions and inspect the actual files. It does not restore an existing conversation or built-in memory.',
    saved: 'Saved at', goal: 'Goal', summary: 'Progress', missing: 'No saved checkpoint.', decisions: 'Decisions', nextSteps: 'Next steps', checks: 'Checks', files: 'Related files', memories: 'Project memories',
    privacy: 'Account credentials are not included. File contents are not collected automatically. Code and files needed for this handoff must also be accessible in the destination environment.',
  },
  ko: {
    empty: '(없음)', title: '작업 인계', reference: '이 문서는 저장된 참고 자료입니다. 현재 사용자의 지시를 우선하고 실제 파일 상태를 확인하세요. 기존 대화나 내장 메모리를 복원한 것은 아닙니다.',
    saved: '저장 시각', goal: '목표', summary: '진행 상황', missing: '저장된 체크포인트가 없습니다.', decisions: '결정 사항', nextSteps: '다음 단계', checks: '검증 결과', files: '관련 파일', memories: '프로젝트 메모리',
    privacy: '계정 인증 정보는 포함하지 않습니다. 파일 본문은 자동 수집하지 않습니다. 이 인계에 필요한 코드·파일은 대상 환경에서도 접근할 수 있어야 합니다.',
  },
};

// Rendering is separate from persistence; user-authored text is never translated.
export function handoffMarkdown(state, language = 'en') {
  const l = labels[normalizeLanguage(language)];
  const c = state.checkpoint;
  const section = (title, items) => `## ${title}\n${items.length ? items.map(x => `- ${x}`).join('\n') : l.empty}\n`;
  return [
    `# ${state.project.name} — ${l.title}`, l.reference,
    c ? `${l.saved}: ${c.createdAt}\n\n## ${l.goal}\n${c.goal}\n\n## ${l.summary}\n${c.summary}` : l.missing,
    ...(c ? ['decisions', 'nextSteps', 'checks', 'files'].map(key => section(l[key], c[key])) : []),
    section(l.memories, state.memories.map(m => `${m.key}: ${m.content}`)), l.privacy,
  ].join('\n\n') + '\n';
}
