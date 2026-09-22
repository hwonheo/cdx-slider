import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// A documented app-server client, never an authentication/session database writer.
export class CompanionRpc extends EventEmitter {
  constructor(command = process.env.CDX_CODEX_BIN || 'codex') {
    super(); this.sequence = 0; this.pending = new Map();
    this.child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method && message.id !== undefined) {
        // Never grant command, file, permission or other approval requests silently.
        this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Approval requires the interactive Codex client.' } }) + '\n');
        this.emit('approvalRequired'); return;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer); this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method) this.emit('notification', message);
    });
    const fail = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('The Codex connection closed.')); } this.pending.clear(); };
    this.child.on('error', fail); this.child.on('exit', fail); this.child.stdin.on('error', fail);
  }
  async connect() {
    await this.request('initialize', { clientInfo: { name: 'cdx-slider-companion', version: '0.1.0' } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  }
  request(method, params, timeout = 20000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The Codex response timed out.')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  close() { this.reader.close(); this.child.stdin.end(); this.child.kill(); }
}
