import { t, getLanguage, getLocale, setLanguage, applyLanguage, setText } from './i18n.mjs';
import { relayTick } from './relay.mjs';
import { panelLinkContext } from './panel-link.mjs';
import { App, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';
import { createDisplayController } from './display.mjs';
import { requestConversationAction, openCompanionBar } from './actions.mjs';

const app = new App({ name: 'CDX Slider', version: '0.1.0' }, { availableDisplayModes: ['inline', 'pip'] });
function applyHostTypography(context) {
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

const $ = id => document.getElementById(id);
applyLanguage(document);
$('language').addEventListener('change', () => {
  setLanguage($('language').value, document);
  renderCheckpoint({ checkpoint });
  controls();
});
const display = createDisplayController(app, state => {
  const hadFocus = document.activeElement;
  $('compact-bar').hidden = !state.compact;
  $('expanded-panel').hidden = state.compact;
  document.body.classList.toggle('pip', state.mode === 'pip');
  document.body.classList.toggle('compact', state.compact);
  $('float-panel').hidden = !state.supported;
  $('float-panel').disabled = !state.supported || state.busy;
  setText($('float-panel'), state.mode === 'pip' ? t("접기") : t("작게 띄우기"));
  $('inline-panel').hidden = state.mode !== 'pip';
  $('inline-panel').disabled = state.busy;
  setText($('display-status'), state.error);
  $('display-status').hidden = !state.error;
  if (hadFocus?.closest('[hidden]')) (state.compact ? $('expand-panel') : $('open-bar')).focus();
});
app.onhostcontextchanged = context => {
  applyHostTypography(context); display.update(context);
  if (connected && initialData?.standalone) {
    try {
      const linked = panelLinkContext(context);
      if (linked && JSON.stringify(linked) !== appliedPanelLink) run(() => populate(initialData));
    } catch (error) { showStatus(error.message, true); }
  }
};
$('float-panel').addEventListener('click', () => display.float());
$('expand-panel').addEventListener('click', () => display.expand());
$('inline-panel').addEventListener('click', () => display.inline());
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(selected, focus = false) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  }
  if (focus) selected.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next], true);
  });
});
let profile = '', project = '', checkpoint = null, connected = false, busy = false, canMessage = false, canTools = false;
let generation = 0;

function showStatus(message, error = false) {
  $('status').hidden = !message;
  setText($('status'), message);
  $('status').classList.toggle('error', error);
}
function controls() {
  $('open-bar').disabled = !canTools || busy;
  $('profile').disabled = !canTools || busy;
  $('profile-register-toggle').disabled = !canTools || busy;
  for (const el of $('profile-register-form').elements) el.disabled = !canTools || busy;
  $('project').disabled = !canTools || busy || !profile;
  $('save').disabled = !canMessage || busy || !profile || !project;
  $('resume').disabled = !canMessage || busy || !project || !checkpoint;
  $('compact-save').disabled = $('save').disabled;
  $('compact-resume').disabled = $('resume').disabled;
  setText($('compact-project'), project || 'CDX Slider', true);
  $('compact-project').title = project || t("프로젝트를 선택하려면 펼치세요");
  $('refresh').disabled = !canTools || busy || !project;
  $('register-toggle').disabled = !canTools || busy || !profile;
  for (const el of $('register-form').elements) el.disabled = !canTools || busy || !profile;
}
function options(select, rows, selected, placeholder, key = 'id', label = 'name') {
  select.replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; setText(empty, placeholder); select.append(empty);
  for (const row of rows) {
    const option = document.createElement('option'); option.value = row[key]; option.textContent = row[label]; select.append(option);
  }
  select.value = rows.some(r => r[key] === selected) ? selected : '';
}
function renderCheckpoint(state) {
  checkpoint = state?.checkpoint ?? null;
  setText($('saved-at'), checkpoint ? new Date(checkpoint.createdAt).toLocaleString(getLocale()) : project ? t("아직 저장한 체크포인트가 없습니다.") : t("프로젝트를 선택해 주세요."));
  setText($('summary'), checkpoint?.summary || (project ? t("현재 대화 저장을 눌러 첫 작업 내용을 남겨보세요.") : t("저장할 프로젝트를 고르거나 새로 등록하세요.")), Boolean(checkpoint?.summary));
  $('details').hidden = !checkpoint;
  setText($('details-content'), checkpoint ? t("목표\n{0}\n\n다음 단계\n{1}\n\n결정 사항\n{2}\n\n검증 결과\n{3}" , [checkpoint.goal, checkpoint.nextSteps.join('\n'), checkpoint.decisions.join('\n'), checkpoint.checks.join('\n')]) : '');
  controls();
}
async function tool(name, args) {
  const localizedArgs = ['companion_open', 'relay_poll', 'relay_ack', 'login_start', 'login_cancel', 'restart_schedule', 'restart_cancel'].includes(name) ? { ...args, language: getLanguage() } : args;
  const result = await app.callServerTool({ name, arguments: localizedArgs }, { timeout: 15000 });
  if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text || t("작업을 완료하지 못했습니다."));
  return result.structuredContent || JSON.parse(result.content.find(c => c.type === 'text').text);
}
let restartState = { supported: false, status: 'idle' }, restartTimer, restartBusy = false;
function renderRestart() {
  const loginActive = ['starting','pending','cancelling'].includes(loginState.status) || loginBusy;
  const scheduled = ['scheduled','restarting'].includes(restartState.status);
  $('restart-saved').disabled = loginActive || scheduled || restartBusy;
  $('restart-auto').disabled = !restartState.supported || !$('restart-saved').checked || loginActive || scheduled || restartBusy;
  $('restart-now').disabled = !canTools || !restartState.supported || !$('restart-saved').checked || loginActive || scheduled || restartBusy;
  $('restart-cancel').hidden = restartState.status !== 'scheduled';
  $('restart-cancel').disabled = restartBusy;
  setText($('restart-status'), !restartState.supported ? t("이 설치에서는 macOS Codex 재시작을 사용할 수 없습니다.")
    : restartState.status === 'scheduled' ? t("{0}초 뒤 Codex 종료·재실행을 요청합니다. 취소할 수 있습니다." , [Math.max(0,Math.ceil((restartState.restartAt-Date.now())/1000))])
    : ({ idle:t("재시작은 자동 저장을 수행하지 않습니다."),cancelled:t("재시작 예약을 취소했습니다."),restarting:t("앱 종료·재실행 요청 중입니다. 정상 종료가 되지 않으면 강제 종료하지 않습니다."),requested:t("재실행 요청을 전달했습니다. 계정 반영을 확인하세요."),failed:t("재시작에 실패했습니다. 앱을 직접 종료·실행해 주세요.") }[restartState.status] || t("상태를 확인할 수 없습니다.")));
}
async function updateRestart() {
  clearTimeout(restartTimer);
  try { restartState = await tool('restart_status', {}); renderRestart(); if (['scheduled','restarting'].includes(restartState.status)) restartTimer = setTimeout(updateRestart,1000); }
  catch { setText($('restart-status'), t("재시작 상태 연결이 끊겼습니다. 앱 종료 중일 수 있습니다.")); }
}
$('restart-saved').addEventListener('change',()=>{if (!$('restart-saved').checked) $('restart-auto').checked=false;renderRestart();});
function confirmRestart() {
  return new Promise(resolve => {
    const dialog = $('restart-confirm');
    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
$('restart-now').addEventListener('click',async()=>{
  if (restartBusy || !$('restart-saved').checked) return;
  restartBusy=true;renderRestart();
  try { if (!await confirmRestart()) return; restartState=await tool('restart_schedule',{workSaved:true});renderRestart();restartTimer=setTimeout(updateRestart,1000); }
  catch(error) { showStatus(error.message, true); }
  finally { restartBusy=false; renderRestart(); }
});
$('restart-cancel').addEventListener('click',async()=>{
  restartBusy=true;renderRestart();
  try { restartState=await tool('restart_cancel',{});clearTimeout(restartTimer);restartBusy=false;renderRestart(); }
  catch(error){restartBusy=false;$('restart-cancel').disabled=false;setText($('restart-status'), error.message);}
});

let loginState = { status: 'idle' }, loginTimer, loginBusy = false;
const loginMessages = () => ({ idle: '', starting: t("로그인 준비 중…"), pending: t("공식 로그인 페이지에서 계정과 워크스페이스를 선택하세요."), cancelling: t("취소 요청 처리 중…"), cancelled: t("로그인 요청을 취소했습니다."), expired: t("로그인 요청이 만료됐습니다. 다시 시작하세요."), failed: t("로그인을 완료하지 못했습니다. 다시 시작하세요."), completed: t("로컬 Codex 재로그인이 완료됐습니다. 데스크톱의 계정·워크스페이스는 앱에서 별도로 확인하세요.") });
function renderLogin() {
  $('login-start').disabled = !canTools || loginBusy || ['starting','pending','cancelling'].includes(loginState.status);
  $('login-open').hidden = loginState.status !== 'pending' || !loginState.authUrl;
  $('login-cancel').hidden = loginState.status !== 'pending';
  $('login-cancel').disabled = loginBusy;
  renderRestart();
  setText($('login-status'), loginMessages()[loginState.status] ?? t("로그인 상태를 확인할 수 없습니다."));
}
async function updateLogin() {
  clearTimeout(loginTimer);
  try {
    loginState = await tool('login_status', {}); renderLogin();
    if (['starting','pending','cancelling'].includes(loginState.status)) loginTimer = setTimeout(updateLogin, 2000);
    else if (loginState.status === 'completed') { void refreshAccount(); void refreshWorkspace(); void updateRestart(); }
  } catch { setText($('login-status'), t("로그인 상태 연결이 끊겼습니다. 패널을 다시 열어 확인하세요.")); }
}
$('login-start').addEventListener('click', async () => {
  if (loginBusy) return;
  loginBusy = true; renderLogin();
  try {
    const autoRestart = restartState.supported && $('restart-auto').checked && $('restart-saved').checked;
    if (autoRestart && !await confirmRestart()) return;
    loginState = await tool('login_start', {autoRestart,workSaved:autoRestart}); renderLogin(); if (loginState.status === 'pending') loginTimer = setTimeout(updateLogin, 2000); }
  catch (error) { setText($('login-status'), t("재로그인을 시작하지 못했습니다: {0}" , [error.message])); }
  finally { loginBusy = false; $('login-cancel').disabled = false; renderRestart(); $('login-start').disabled = !canTools || ['starting','pending','cancelling'].includes(loginState.status); }
});
$('login-open').addEventListener('click', async () => {
  if (!loginState.authUrl || loginState.status !== 'pending') return;
  try { const result = await app.openLink({ url: loginState.authUrl }); if (result.isError) throw new Error(); }
  catch { setText($('login-status'), t("호스트에서 로그인 페이지를 열지 못했습니다. 요청을 취소하고 Codex에서 직접 로그인하세요.")); }
});
$('login-cancel').addEventListener('click', async () => {
  if (loginBusy) return;
  loginBusy = true; renderLogin();
  try { loginState = await tool('login_cancel', { sessionId: loginState.sessionId }); renderLogin(); loginTimer = setTimeout(updateLogin, 1000); }
  catch { setText($('login-status'), t("취소 상태를 확인하지 못했습니다.")); }
  finally { loginBusy = false; $('login-cancel').disabled = false; }
});
window.addEventListener('pagehide', () => { clearTimeout(loginTimer); clearTimeout(restartTimer); });

let workspaceBusy = false, previousWorkspaceId = null;
async function refreshWorkspace() {
  if (workspaceBusy || !canTools) return;
  workspaceBusy = true;
  $('workspace-refresh').disabled = true;
  setText($('workspace-identity'), t("워크스페이스 확인 중…"));
  setText($('workspace-change'), '');
  setText($('workspace-checked'), '');
  try {
    const result = await tool('workspace_read', {});
    const id = result.status === 'ok' ? result.workspace?.id : null;
    setText($('workspace-identity'), id ? `ID: ${id}` : result.status === 'signed_out' ? t("로컬 Codex에 로그인되어 있지 않습니다.") : t("워크스페이스 ID를 확인할 수 없습니다."));
    if (id && previousWorkspaceId) setText($('workspace-change'), id === previousWorkspaceId
      ? t("이 패널의 이전 조회와 동일한 로컬 워크스페이스입니다.")
      : t("로컬 워크스페이스 ID 변경을 확인했습니다. 데스크톱 전환 완료를 의미하지는 않습니다."));
    if (id) previousWorkspaceId = id;
    setText($('workspace-checked'), result.checkedAt ? t("마지막 확인: {0}" , [new Date(result.checkedAt)]) : '');
  } catch { setText($('workspace-identity'), t("워크스페이스 조회에 실패했습니다. 다시 확인해 주세요.")); }
  finally { workspaceBusy = false; $('workspace-refresh').disabled = !canTools; }
}
$('workspace-refresh').addEventListener('click', refreshWorkspace);

let accountBusy = false;
async function refreshAccount() {
  if (accountBusy || !canTools) return;
  accountBusy = true;
  $('account-refresh').disabled = true;
  setText($('account-identity'), t("계정 확인 중…"));
  $('account-plan').hidden = true;
  setText($('account-checked'), '');
  try {
    const result = await tool('account_read', {});
    setText($('account-identity'), result.account?.email || (result.account?.type === 'apiKey' ? t("API 키 인증") : result.status === 'signed_out' ? t("로컬 Codex에 로그인되어 있지 않습니다.") : t("계정 정보를 확인할 수 없습니다.")), Boolean(result.account?.email));
    setText($('account-plan'), result.account?.planType ? t("요금제: {0}", [result.account.planType]) : t("요금제: 확인되지 않음"));
    $('account-plan').hidden = !result.account;
    setText($('account-checked'), result.checkedAt ? t("마지막 확인: {0}" , [new Date(result.checkedAt)]) : '');
  } catch {
    setText($('account-identity'), t("계정 조회에 실패했습니다. 최신 플러그인으로 패널을 다시 열어주세요."));
  } finally { accountBusy = false; $('account-refresh').disabled = !canTools; }
}
$('account-refresh').addEventListener('click', refreshAccount);

async function refresh() {
  const requestGeneration = ++generation;
  renderCheckpoint(null);
  if (!project) return;
  const state = await tool('project_resume', { profile, project });
  if (requestGeneration === generation) renderCheckpoint(state);
}
async function setProfile(next, selectedProject = '') {
  generation++; profile = next; project = ''; renderCheckpoint(null);
  if (!profile) { options($('project'), [], '', t("프로필을 먼저 선택하세요")); return; }
  const requestProfile = profile;
  const result = await tool('projects_list', { profile });
  if (profile !== requestProfile) return;
  options($('project'), result.projects, selectedProject, t("프로젝트를 선택하세요"));
  project = $('project').value;
  await refresh();
}
async function run(fn) {
  if (busy) return;
  busy = true; controls(); showStatus('');
  try { await fn(); } catch (error) { showStatus(error.message, true); }
  finally { busy = false; controls(); }
}
function registration(open) {
  $('register-form').hidden = !open;
  $('register-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('project-name').focus();
}
function profileRegistration(open) {
  $('profile-register-form').hidden = !open;
  $('profile-register-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('profile-label').focus();
}
$('profile-register-toggle').addEventListener('click', () => profileRegistration($('profile-register-form').hidden));
$('profile-register-cancel').addEventListener('click', () => profileRegistration(false));
$('profile-register-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const created = await tool('profile_register', {
      id: $('profile-id').value.trim(), label: $('profile-label').value.trim(), kind: 'desktop',
    });
    // Use the successful result immediately; a failed follow-up read must not
    // leave a newly created profile invisible or encourage duplicate creation.
    const option = document.createElement('option');
    option.value = created.id; option.textContent = created.label;
    $('profile').append(option); $('profile').value = created.id;
    $('profile-empty').hidden = true;
    profileRegistration(false);
    await setProfile(created.id);
    registration(true);
    showStatus(t("프로필을 만들고 선택했습니다. 이어서 프로젝트를 등록하세요."));
  });
});
$('profile').addEventListener('change', () => run(() => setProfile($('profile').value)));
$('project').addEventListener('change', () => run(async () => { project = $('project').value; await refresh(); }));
$('open-bar').addEventListener('click', () => run(async () => {
  const result = await openCompanionBar({ tool, bridge: app, canMessage, profile, project });
  showStatus(result.message);
}));
$('refresh').addEventListener('click', () => run(async () => { await refresh(); showStatus(t("최신 저장 내용을 확인했습니다.")); }));
$('register-toggle').addEventListener('click', () => registration($('register-form').hidden));
$('register-cancel').addEventListener('click', () => registration(false));
$('register-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const next = $('project-id').value.trim();
    await tool('project_register', { project: next, profile, name: $('project-name').value.trim(), path: $('project-path').value.trim() });
    registration(false); await setProfile(profile, next); showStatus(t("프로젝트를 등록했습니다. 현재 대화 저장으로 첫 체크포인트를 남길 수 있습니다."));
  });
});
for (const action of ['save', 'resume']) for (const id of [action, `compact-${action}`]) $(id).addEventListener('click', () => run(async () => {
  if (!canMessage) return;
  const result = await requestConversationAction(app, action, profile, project);
  showStatus(result.message);
}));

let relayChannel = null, relayTimer, relayRunning = false, relayStopped = false;
function relayMatches(channel) {
  return !relayStopped && channel === relayChannel && profile === channel.profile && project === channel.project && canMessage;
}
async function pollRelay() {
  clearTimeout(relayTimer);
  const channel = relayChannel;
  if (relayRunning || !channel || !relayMatches(channel) || busy) {
    if (!relayStopped) relayTimer = setTimeout(pollRelay, 1000);
    return;
  }
  relayRunning = true;
  try {
    await relayTick({ bridge:app, tool, channel, isCurrent:() => relayMatches(channel),
      report:message => { setText($('relay-status'), message); } });
  } catch (error) {
    setText($('relay-status'), t("미니바 중계 중단: {0}" , [error.message]));
    relayChannel = null;
  } finally {
    relayRunning = false;
    if (!relayStopped && relayChannel) relayTimer = setTimeout(pollRelay, 1000);
  }
}
window.addEventListener('pagehide', () => { relayStopped = true; clearTimeout(relayTimer); });
let initialData;
let appliedPanelLink;
async function populate(data) {
  initialData = data;
  if (!connected || !data?.profiles) return;
  if (data.standalone) {
    canMessage = false;
    relayChannel = null; clearTimeout(relayTimer);
    setText($('connection'), t("독립 패널"));
    $('connection').classList.toggle('connected', false);
    setText($('action-hint'), t("프로젝트 관리 패널입니다. 대화 저장·불러오기는 해당 대화에서 CDX Slider를 열어 사용하세요."));
    const linked = panelLinkContext(app.getHostContext());
    const key = JSON.stringify(linked);
    if (canTools && linked && key !== appliedPanelLink) {
      appliedPanelLink = key;
      try { data = await tool('slider_home', linked); initialData = data; }
      catch (error) { appliedPanelLink = undefined; throw error; }
    }
  }
  options($('profile'), data.profiles, data.selectedProfile, t("프로필을 선택하세요"), 'id', 'label');
  $('profile-empty').hidden = data.profiles.length !== 0;
  if (canTools && data.profiles.length === 0) profileRegistration(true);
  $('project-path').value = data.contextPath || '';
  $('project-name').value = data.suggestedName || '';
  $('project-id').value = data.suggestedId || '';
  if (canTools) {
    await setProfile($('profile').value, data.selectedProject || '');
    relayChannel = data.standalone ? null : data.relay || null;
    setText($('relay-status'), relayChannel
      ? t("미니바 불러오기 연결 · 대화 {0}. 이 패널을 열어 두세요." , [relayChannel.threadId.slice(-8)])
      : t("미니바 중계 미연결"));
    if (relayChannel && canMessage) { clearTimeout(relayTimer); relayTimer = setTimeout(pollRelay, 1000); }
  }
  else showStatus(t("이 화면은 프로젝트 도구 연결을 지원하지 않습니다."), true);
}
app.ontoolresult = result => {
  if (result.isError) return showStatus(t("패널 데이터를 불러오지 못했습니다."), true);
  const data = result.structuredContent;
  if (data?.profiles) run(() => populate(data));
};
app.onerror = error => showStatus(t("연결 오류: {0}" , [error.message]), true);
const timeout = setTimeout(() => {
  if (!connected) {
    setText($('connection'), t("대화 연결 없음"));
    setText($('action-hint'), t("대화 안에서 CDX Slider 패널을 열어야 현재 대화 저장을 사용할 수 있습니다."));
  }
}, 5000);
try {
  await app.connect();
  applyHostTypography(app.getHostContext());
  display.update(app.getHostContext());
  clearTimeout(timeout);
  connected = true;
  canTools = !!app.getHostCapabilities()?.serverTools;
  canMessage = !!app.getHostCapabilities()?.message?.text && document.documentElement?.dataset.sliderStandalone !== 'true';
  if (canTools) { void refreshAccount(); void refreshWorkspace(); void updateLogin(); void updateRestart(); }
  else setText($('account-identity'), t("이 호스트는 계정 조회를 지원하지 않습니다."));
  setText($('connection'), canMessage ? t("대화 연결됨") : t("대화 저장 미지원"));
  $('connection').classList.toggle('connected', canMessage);
  setText($('action-hint'), canMessage
    ? t("버튼을 누르면 현재 대화의 에이전트에게 저장을 요청합니다.")
    : t("이 호스트는 대화에 요청을 보내는 기능을 제공하지 않아 저장·불러오기 버튼을 사용할 수 없습니다."));
  if (document.documentElement?.dataset.sliderStandalone === 'true' && canTools) {
    await populate(await tool('slider_home', panelLinkContext(app.getHostContext()) || {}));
  } else if (initialData) await populate(initialData);
  controls();

} catch (error) { clearTimeout(timeout); setText($('connection'), t("연결 실패")); showStatus(error.message, true); }
