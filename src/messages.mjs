// Protocol locale values use BCP 47; UI labels may display EN and KR.
export function normalizeLanguage(language) { return language === 'ko' ? 'ko' : 'en'; }

const messages = {
  "folderMismatch": {
    "en": "This conversation folder does not match the selected project.",
    "ko": "이 대화의 폴더가 선택한 프로젝트와 다릅니다."
  },
  "busy": {
    "en": "Wait for the current request to finish, then try again.",
    "ko": "진행 중인 요청이 끝난 후 다시 시도하세요."
  },
  "idMismatch": {
    "en": "The returned conversation ID does not match the request. Select it again.",
    "ko": "요청한 대화 ID와 조회 결과가 다릅니다. 다시 선택하세요."
  },
  "noBinding": {
    "en": "No conversation is connected.",
    "ko": "대화 연결이 없습니다."
  },
  "unknownAction": {
    "en": "Unknown action.",
    "ko": "알 수 없는 동작입니다."
  },
  "bindFirst": {
    "en": "Connect a conversation in Settings before saving or loading.",
    "ko": "설정에서 저장·불러오기 대상 대화를 먼저 연결하세요."
  },
  "unverifiedBinding": {
    "en": "Unable to verify the connected conversation ID. Connect it again.",
    "ko": "연결된 대화 ID를 확인하지 못했습니다. 다시 연결하세요."
  },
  "noCheckpoint": {
    "en": "No checkpoint is available to load.",
    "ko": "불러올 체크포인트가 없습니다."
  },
  "clipboard": {
    "en": "The request is ready to copy. Paste it into the open conversation and send it. The request has not run yet.",
    "ko": "요청문이 복사할 준비가 되었습니다. 열린 대화에 붙여넣고 보내세요. 아직 요청은 실행되지 않았습니다."
  },
  "relayChanged": {
    "en": "The relay connection changed. Reopen the panel in this conversation.",
    "ko": "중계 연결이 바뀌었습니다. 이 대화에서 패널을 다시 여세요."
  },
  "relayUnavailable": {
    "en": "The connected conversation relay panel is not responding. Open its relay panel.",
    "ko": "연결된 대화의 중계 패널이 응답하지 않습니다. 해당 대화에서 중계 패널을 열어 주세요."
  },
  "relayExpired": {
    "en": "The relay acknowledgement target expired or was already handled.",
    "ko": "중계 응답 대상이 만료되었거나 이미 처리되었습니다."
  },
  "relayMissing": {
    "en": "Relay request not found.",
    "ko": "중계 요청을 찾지 못했습니다."
  },
  "loginRestartUnsupported": {
    "en": "Automatic restart support and confirmation that work is saved/stopped are required.",
    "ko": "자동 재시작 지원과 작업 저장·중단 확인이 필요합니다."
  },
  "loginChanged": {
    "en": "The login request changed. Refresh its status.",
    "ko": "로그인 요청이 변경되었습니다. 상태를 새로 확인하세요."
  },
  "confirmSaved": {
    "en": "Confirm that ongoing work is saved or stopped first.",
    "ko": "진행 중인 작업 저장·중단을 먼저 확인하세요."
  },
  "restartUnsupported": {
    "en": "Unable to identify a macOS Codex restart target in this installation.",
    "ko": "이 설치에서는 macOS Codex 재시작 대상을 확인할 수 없습니다."
  },
  "restartDispatched": {
    "en": "The app termination request was already sent and cannot be cancelled.",
    "ko": "앱 종료 요청이 이미 전달되어 취소할 수 없습니다."
  },
  "companionMacOnly": {
    "en": "CDX Slider Bar is available on macOS.",
    "ko": "CDX Slider Bar는 macOS에서 사용할 수 있습니다."
  },
  "companionMissing": {
    "en": "CDX Slider Bar was not found. Run npm run build:companion and npm run install:companion in the project.",
    "ko": "CDX Slider Bar 앱을 찾지 못했습니다. 프로젝트에서 npm run build:companion 후 npm run install:companion을 실행하세요."
  },
  "companionRequested": {
    "en": "Requested CDX Slider Bar to open.",
    "ko": "CDX Slider Bar 표시를 요청했습니다."
  }
};

export function message(key, language = 'en') { return messages[key][normalizeLanguage(language)]; }
