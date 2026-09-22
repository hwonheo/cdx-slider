import { check as checkUpdate, status as updateState, patchState as updateSettings, launchUpdate } from './updates.mjs';
import { message, normalizeLanguage } from './messages.mjs';
import { companionPrompt } from './companion-prompts.mjs';
import { withRelay } from './relay.mjs';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { CompanionRpc } from './companion-rpc.mjs';

export class Companion {
  constructor(store, rpc) {
    this.store = store; this.rpc = rpc; this.busy = false;
    this.settingsFile = join(store.home, 'companion.json');
    try { this.settings = JSON.parse(readFileSync(this.settingsFile, 'utf8')); } catch { this.settings = {}; }
    this.settings.bindings ||= {};
  }
  persist() {
    const temp = `${this.settingsFile}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.settings), { mode: 0o600 }); renameSync(temp, this.settingsFile);
  }
  key(profile, project) { return `${profile}/${project}`; }
  state() {
    const projects = this.store.profiles().flatMap(p => this.store.projects(p.id).map(project => ({ ...project, profile: p.id, profileLabel: p.label })));
    const selected = projects.find(p => this.key(p.profile,p.id) === this.settings.selected) || projects[0];
    return { projects, selected: selected ? this.key(selected.profile,selected.id) : '', bindings: this.settings.bindings };
  }
  async thread(profile, project, threadId, language = 'en') {
    const p = this.store.project(project, profile);
    const { thread } = await this.rpc.request('thread/read', { threadId, includeTurns: true });
    if (resolve(thread.cwd) !== resolve(p.path)) throw new Error(message('folderMismatch', language));
    return thread;
  }
  async handle({ action, profile, project, threadId, requestId, automatic, language = 'en' }) {
    language = normalizeLanguage(language);
    if (action === 'update-status') return updateState();
    if (action === 'update-settings') {
      if (typeof automatic !== 'boolean') throw Error('Expected an automatic update preference.');
      return updateSettings({ automatic });
    }
    if (action === 'state') return this.state();
    if (this.busy) throw new Error(message('busy', language));
    if (['update-check', 'update-apply', 'update-auto'].includes(action)) {
      const root = process.env.CDX_SLIDER_INSTALL_ROOT;
      if (!root) throw Error('Stage and reinstall CDX Slider to configure updates.');
      if (action === 'update-check') return checkUpdate(root);
      return launchUpdate(root, { automatic: action === 'update-auto' });
    }
    if (action === 'panel') {
      const url = new URL('codex://mcp-app/cdx-slider%40personal/slider_home');
      if (profile || project) {
        this.store.project(project, profile);
        url.searchParams.set('profile', profile);
        url.searchParams.set('project', project);
      }
      return { delivery: 'deeplink', url: url.href };
    }
    const p = this.store.project(project, profile);
    const key = this.key(profile,project);
    if (action === 'select') { this.settings.selected = key; this.persist(); return this.state(); }
    if (action === 'threads') {
      const rows = []; let cursor;
      do {
        const result = await this.rpc.request('thread/list', { cwd: p.path, limit: 100, cursor, sortKey: 'updated_at', archived: false });
        rows.push(...result.data.filter(t => resolve(t.cwd) === resolve(p.path)).map(t => ({ id:t.id, title:t.name || t.preview || t.id })));
        cursor = result.nextCursor;
      } while (cursor && rows.length < 500);
      return { threads:rows };
    }
    if (action === 'bind') {
      this.busy = true;
      try {
        const t = await this.thread(profile,project,threadId,language);
        if (t.id !== threadId) throw new Error(message('idMismatch', language));
        this.settings.bindings[key] = { id:t.id, title:t.name || t.preview || t.id };
        this.settings.selected = key; this.persist(); return this.state();
      } finally { this.busy = false; }
    }
    if (action === 'relay-status') {
      const binding = this.settings.bindings[key];
      if (!binding) throw Error(message('noBinding', language));
      return withRelay(this.store, r => r.status({ profile, project, threadId:binding.id, requestId, language }));
    }
    if (!['save','resume','panel','relay-resume'].includes(action)) throw new Error(message('unknownAction', language));
    const binding = this.settings.bindings[key];
    if (!binding) throw new Error(message('bindFirst', language));
    this.busy = true;
    try {
      const thread = await this.thread(profile,project,binding.id,language);
      if (thread.id !== binding.id) throw new Error(message('unverifiedBinding', language));
      if (['resume','relay-resume'].includes(action) && !this.store.resume({profile,project}).checkpoint) throw new Error(message('noCheckpoint', language));
      if (action === 'relay-resume') return withRelay(this.store, r => r.enqueue({profile,project,threadId:binding.id,language}));
      const prompt = companionPrompt(action, { profile, project, path: p.path, threadId: binding.id, language });
      // A separate app-server cannot acquire a Desktop-owned thread writer.
      // Prepare a user-mediated handoff; never resume/start/steal the writer.
      return { delivery:'clipboard', prompt, threadId:binding.id,
        message:message('clipboard', language) };
    } finally { this.busy = false; }
  }

}

export async function main() {
  const store = new Store(); const rpc = new CompanionRpc(); const companion = new Companion(store,rpc);
  let connection;
  const lines = createInterface({input:process.stdin});
  lines.on('line', async line => {
    let request;
    try {
      request = JSON.parse(line);
      if (!['state','select','relay-status','panel','update-status','update-settings','update-check','update-apply','update-auto'].includes(request.action)) { connection ||= rpc.connect().catch(e => { connection=undefined; throw e; }); await connection; }
      const result = await companion.handle(request);
      process.stdout.write(JSON.stringify({id:request.id,result})+'\n');
    } catch(error) { process.stdout.write(JSON.stringify({id:request?.id,error:error.message})+'\n'); }
  });
  lines.on('close',()=>{rpc.close();store.close();});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
