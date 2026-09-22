import { message } from './messages.mjs';
import { DatabaseSync } from 'node:sqlite';
import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Separate from saved project context. A claimed request is never redelivered:
// a lost host acknowledgement is ambiguous, not permission to send twice.
export class Relay {
  constructor(home, now = Date.now) {
    this.now = now;
    const file = join(home, 'relay.db');
    try { closeSync(openSync(file, 'wx', 0o600)); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS channels (token TEXT PRIMARY KEY, profile TEXT, project TEXT, thread TEXT, seen INTEGER);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, token TEXT, status TEXT, created INTEGER);
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  open({ profile, project, threadId }) {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM channels WHERE profile=? AND project=? AND thread=?').run(profile, project, threadId);
      this.db.prepare('DELETE FROM requests WHERE created<?').run(this.now() - 86400000);
      this.db.prepare('DELETE FROM channels WHERE seen<?').run(this.now() - 86400000);
      const token = randomUUID();
      this.db.prepare('INSERT INTO channels VALUES (?,?,?,?,0)').run(token, profile, project, threadId);
      return { token, profile, project, threadId };
    });
  }
  poll({ token, profile, project, language = 'en' }) {
    return this.transaction(() => {
      const channel = this.db.prepare('SELECT * FROM channels WHERE token=? AND profile=? AND project=?').get(token, profile, project);
      if (!channel) throw Error(message('relayChanged', language));
      this.db.prepare('UPDATE channels SET seen=? WHERE token=?').run(this.now(), token);
      this.db.prepare("UPDATE requests SET status='expired' WHERE token=? AND status='queued' AND created<?").run(token, this.now() - 15000);
      const request = this.db.prepare("SELECT id FROM requests WHERE token=? AND status='queued' ORDER BY created LIMIT 1").get(token);
      if (request) this.db.prepare("UPDATE requests SET status='dispatching' WHERE id=?").run(request.id);
      return { request: request ? { id: request.id, action: 'resume' } : null };
    });
  }
  enqueue({ profile, project, threadId, language = 'en' }) {
    return this.transaction(() => {
      const channel = this.db.prepare('SELECT * FROM channels WHERE profile=? AND project=? AND thread=? AND seen>?').get(profile, project, threadId, this.now() - 6000);
      if (!channel) throw Error(message('relayUnavailable', language));
      const pending = this.db.prepare("SELECT id FROM requests WHERE token=? AND status IN ('queued','dispatching') AND created>?").get(channel.token, this.now() - 30000);
      if (pending) return { requestId: pending.id, status: 'queued' };
      const id = randomUUID();
      this.db.prepare("INSERT INTO requests VALUES (?,?,'queued',?)").run(id, channel.token, this.now());
      return { requestId: id, status: 'queued' };
    });
  }
  ack({ token, requestId, status, language = 'en' }) {
    const result = this.db.prepare("UPDATE requests SET status=? WHERE id=? AND token=? AND status='dispatching' AND EXISTS (SELECT 1 FROM channels WHERE token=?)").run(status, requestId, token, token);
    if (!result.changes) throw Error(message('relayExpired', language));
    return { status };
  }
  status({ requestId, profile, project, threadId, language = 'en' }) {
    const row = this.db.prepare('SELECT r.status,r.created FROM requests r JOIN channels c ON c.token=r.token WHERE r.id=? AND c.profile=? AND c.project=? AND c.thread=?').get(requestId, profile, project, threadId);
    if (!row) throw Error(message('relayMissing', language));
    if (['queued','dispatching'].includes(row.status) && this.now() - row.created > 20000) return { status: row.status === 'queued' ? 'expired' : 'unknown' };
    return { status: row.status };
  }
}

export function withRelay(store, fn) {
  const relay = new Relay(store.home);
  try { return fn(relay); } finally { relay.close(); }
}
