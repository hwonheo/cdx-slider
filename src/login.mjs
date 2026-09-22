import { message } from './messages.mjs';
import { restartController } from './restart.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

// OAuth stays inside Codex; Slider holds only a short-lived URL and status in memory.
export class LoginController {
  constructor({ command = process.env.CDX_CODEX_BIN || 'codex', timeoutMs = 300000, startupMs = 10000, restart = restartController } = {}) {
    Object.assign(this, { command, timeoutMs, startupMs, restart });
    this.state = { status: 'idle' };
  }
  status() { return { ...this.state, source: 'local-codex', desktopAccountVerified: false }; }
  async start({ autoRestart = false, workSaved = false, language = 'en' } = {}) {
    if (this.starting) return this.starting;
    if (this.child) return this.status();
    if (autoRestart && (!workSaved || !this.restart.status().supported)) throw new Error(message('loginRestartUnsupported', language));
    this.autoRestart = autoRestart;
    this.state = { sessionId: randomUUID(), status: 'starting', startedAt: new Date().toISOString() };
    const env = { ...process.env };
    for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_ORG_ID','OPENAI_PROJECT_ID']) delete env[key];
    const child = this.child = spawn(this.command, ['app-server'], { env, stdio: ['pipe','pipe','pipe'] });
    const reader = this.reader = createInterface({ input: child.stdout });
    child.stderr.resume();
    let resolveStart, bytes = 0;
    this.starting = new Promise(resolve => { resolveStart = resolve; });
    const pending = this.starting;
    this.resolveStart = () => { clearTimeout(this.startTimer); this.starting = null; resolveStart(this.status()); };
    this.startTimer = setTimeout(() => this.finish('failed'), this.startupMs);
    this.timer = setTimeout(() => this.finish('expired'), this.timeoutMs);
    const send = message => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n'); };
    this.send = send;
    child.on('error', () => { if (this.child === child) this.finish('failed'); });
    child.stdin.on('error', () => { if (this.child === child) this.finish('failed'); });
    child.on('exit', () => { if (this.child === child) this.finish('failed'); });
    child.stdout.on('data', data => { bytes += data.length; if (this.child === child && bytes > 2 * 1024 * 1024) this.finish('failed'); });
    reader.on('line', line => {
      if (this.child !== child) return;
      let msg; try { msg = JSON.parse(line); } catch { return this.finish('failed'); }
      if (msg.id === 1) {
        if (msg.error) return this.finish('failed');
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/login/start', params: { type: 'chatgpt' } });
      } else if (msg.id === 2) {
        const r = msg.result;
        let url; try { url = new URL(r?.authUrl); } catch { return this.finish('failed'); }
        if (msg.error || r?.type !== 'chatgpt' || typeof r.loginId !== 'string' || url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password) return this.finish('failed');
        this.loginId = r.loginId;
        this.state = { ...this.state, status: 'pending', authUrl: url.href };
        this.resolveStart();
        if (this.earlyCompletion) this.complete(this.earlyCompletion);
      } else if (msg.method === 'account/login/completed') {
        if (!this.loginId) this.earlyCompletion = msg.params;
        else this.complete(msg.params);
      } else if (msg.id === 3) {
        if (msg.error) return this.finish('failed');
        this.finish('cancelled');
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'cdx-slider-login', version: '1' } } });
    return pending;
  }
  complete(params) {
    if (params?.loginId !== this.loginId) return;
    const restart = params.success === true && this.autoRestart && this.state.status !== 'cancelling';
    this.finish(params.success === true ? 'completed' : 'failed');
    if (restart) { try { this.restart.schedule(true); } catch { this.state.restartFailed = true; } }
  }
  cancel(sessionId, language = 'en') {
    if (sessionId !== this.state.sessionId) throw new Error(message('loginChanged', language));
    if (this.state.status === 'pending') {
      this.state.status = 'cancelling';
      this.send({ id: 3, method: 'account/login/cancel', params: { loginId: this.loginId } });
      this.cancelTimer = setTimeout(() => this.finish('failed'), 3000);
    }
    return this.status();
  }
  finish(status) {
    if (!this.child) return;
    this.state = { sessionId: this.state.sessionId, status, startedAt: this.state.startedAt };
    this.resolveStart?.(); this.resolveStart = null;
    for (const timer of [this.timer,this.startTimer,this.cancelTimer]) clearTimeout(timer);
    const child = this.child; this.child = null;
    this.reader.close(); child.stdin.destroy(); child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 300).unref();
    this.loginId = null; this.earlyCompletion = null;
  }
  close() { this.finish('cancelled'); }
}
export const loginController = new LoginController();
