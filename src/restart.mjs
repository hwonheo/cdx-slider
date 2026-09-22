import { message } from './messages.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function detectRestartTarget() {
  if (process.platform !== 'darwin') return null;
  const match = process.env.CDX_CODEX_BIN?.match(/^(.*\.app)\/Contents\//);
  if (!match) return null;
  const path = match[1];
  try {
    const id = execFileSync('/usr/libexec/PlistBuddy', ['-c','Print :CFBundleIdentifier',`${path}/Contents/Info.plist`], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    if (id !== 'com.openai.codex' || !existsSync(fileURLToPath(new URL('./restart-helper.js',import.meta.url)))) return null;
    return path;
  } catch { return null; }
}
// launchd owns the helper so desktop process-tree cleanup cannot kill it.
export function launchRestartHelper(path, { spawnProcess = spawn } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cdx-slider-restart-'));
  const label = `local.cdx-slider.restart.${process.pid}.${Date.now()}`;
  const target = `gui/${process.getuid()}/${label}`;
  const plist = join(directory, 'restart.plist');
  const args = ['/bin/sh', '-c',
    '/usr/bin/osascript -l JavaScript "$1" "$2"; /bin/launchctl bootout "$3"',
    'cdx-slider-restart', fileURLToPath(new URL('./restart-helper.js', import.meta.url)), path, target];
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${escape(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
</dict></plist>`, { mode: 0o600 });
  try {
    const child = spawnProcess('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'ignore' });
    const cleanup = () => rmSync(directory, { recursive: true, force: true });
    child.once('error', cleanup);
    child.once('exit', cleanup);
    return child;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
export class RestartController {
  constructor({ detect = detectRestartTarget, launch = launchRestartHelper, delayMs = 15000 } = {}) {
    Object.assign(this,{detect,launch,delayMs}); this.state={status:'idle'};
  }
  status() { return { ...this.state, supported: !!this.detect(), delaySeconds: this.delayMs/1000 }; }
  schedule(confirmed, language = 'en') {
    if (confirmed !== true) throw new Error(message('confirmSaved', language));
    if (['scheduled','restarting'].includes(this.state.status)) return this.status();
    const path=this.detect();
    if (!path) throw new Error(message('restartUnsupported', language));
    this.state={status:'scheduled',restartAt:Date.now()+this.delayMs};
    this.timer=setTimeout(()=>{
      this.state={status:'restarting'};
      try {
        const child=this.launch(path);
        child.once('error',()=>{this.state={status:'failed'};});
        child.once('exit',code=>{this.state={status:code===0?'requested':'failed'};});
      } catch {this.state={status:'failed'};}
    },this.delayMs);
    return this.status();
  }
  cancel(language = 'en') {
    if (this.state.status==='restarting') throw new Error(message('restartDispatched', language));
    if (this.state.status==='scheduled') {clearTimeout(this.timer);this.state={status:'cancelled'};}
    return this.status();
  }
  close() { clearTimeout(this.timer); }
}
export const restartController=new RestartController();
