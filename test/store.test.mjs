import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, dataHome, gitSnapshot } from '../src/store.mjs';
import { execute } from '../src/service.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'slider-store-'));
  const projectPath = join(dir, 'project');
  mkdirSync(projectPath);
  const store = new Store(join(dir, 'data'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.registerProfile({ id: 'personal', label: 'Personal', kind: 'desktop' });
  store.registerProfile({ id: 'team', label: 'Team', kind: 'desktop' });
  store.registerProject({ project: 'demo', profile: 'personal', path: projectPath, name: 'Demo' });
  return { store, dir, projectPath };
}
const body = { goal: 'Ship the change', summary: 'Implementation done', decisions: ['Use local storage'], nextSteps: ['Review'], checks: ['Tests pass'], files: ['src/main.js'] };

test('profile B cannot discover or resume A project until explicitly shared', async t => {
  const { store } = fixture(t);
  store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body });
  store.putMemory({ project: 'demo', profile: 'personal', key: 'language', content: 'Korean' });
  assert.deepEqual(store.projects('team'), []);
  assert.throws(() => store.resume({ project: 'demo', profile: 'team' }), /not shared/);
  assert.throws(() => store.grant({ project: 'demo', profile: 'team', targetProfile: 'personal' }), /not shared/);
  store.grant({ project: 'demo', profile: 'personal', targetProfile: 'team' });
  const state = store.resume({ project: 'demo', profile: 'team' });
  assert.equal(state.checkpoint.summary, body.summary);
  assert.equal(state.memories[0].content, 'Korean');
  assert.equal(state.checkpoint.sourceProfile, 'personal');
  assert.equal(store.projects('team').length, 1);
});

test('data survives reopening and CODEX_HOME changes without copying credentials', t => {
  const { store, dir } = fixture(t);
  store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body });
  const homeA = dataHome({ CDX_SLIDER_HOME: join(dir, 'data'), CODEX_HOME: '/profile-a' });
  const homeB = dataHome({ CDX_SLIDER_HOME: join(dir, 'data'), CODEX_HOME: '/profile-b' });
  assert.equal(homeA, homeB);
  const other = new Store(homeB);
  try { assert.equal(other.resume({ project: 'demo', profile: 'personal' }).checkpoint.goal, body.goal); }
  finally { other.close(); }
  assert.equal(statSync(join(dir, 'data', 'slider.db')).mode & 0o777, 0o600);
});

test('append-only checkpoints select latest and memory keys update independently', t => {
  const { store } = fixture(t);
  const one = store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body });
  const two = store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body, summary: 'Reviewed' });
  assert.notEqual(one.id, two.id);
  store.putMemory({ project: 'demo', profile: 'personal', key: 'language', content: 'English' });
  store.putMemory({ project: 'demo', profile: 'personal', key: 'language', content: 'Korean' });
  const state = store.resume({ project: 'demo', profile: 'personal' });
  assert.equal(state.checkpoint.summary, 'Reviewed');
  assert.equal(state.memories.length, 1);
  assert.equal(state.memories[0].content, 'Korean');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM checkpoints').get().n, 2);
});

test('schema rejects incomplete checkpoints and credential fields without partial writes', async t => {
  const { store } = fixture(t);
  await assert.rejects(execute(store, 'checkpoint_save', { project: 'demo', profile: 'personal', goal: 'a' }));
  await assert.rejects(execute(store, 'checkpoint_save', { project: 'demo', profile: 'personal', ...body, accessToken: 'secret' }));
  assert.equal(store.resume({ project: 'demo', profile: 'personal' }).checkpoint, null);
  await assert.rejects(execute(store, 'profile_register', { id: '../bad', label: 'bad' }));
});

test('portable export omits local root and profile labels', async t => {
  const { store, projectPath } = fixture(t);
  store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body });
  const out = await execute(store, 'handoff_export', { project: 'demo', profile: 'personal' });
  assert.match(out.content, /Ship the change/);
  assert.equal(out.content.includes(projectPath), false);
  assert.equal(out.content.includes('sourceProfile'), false);
});

test('duplicate project registration fails without granting a second profile', t => {
  const { store, projectPath } = fixture(t);
  assert.throws(() => store.registerProject({ project: 'demo', profile: 'team', path: projectPath, name: 'Other' }));
  assert.deepEqual(store.projects('team'), []);
});

test('git snapshot handles unborn branch and resume reports missing folders', t => {
  const { store, projectPath } = fixture(t);
  execFileSync('git', ['init', '-q', projectPath]);
  writeFileSync(join(projectPath, 'new.txt'), 'work in progress');
  const snapshot = gitSnapshot(projectPath);
  assert.equal(snapshot.head, null);
  assert.equal(snapshot.dirty, true);
  assert.ok(snapshot.branch);
  store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body });
  rmSync(projectPath, { recursive: true });
  const restored = store.resume({ project: 'demo', profile: 'personal' });
  assert.equal(restored.pathAvailable, false);
  assert.equal(restored.workspaceChanged, null);
  assert.equal(restored.checkpoint.goal, body.goal);
});

test('git snapshots exclude sibling changes in an ancestor repository', t => {
  const { dir, projectPath } = fixture(t);
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'private-sibling.txt'), 'private');
  assert.equal(gitSnapshot(projectPath).dirty, false);
  writeFileSync(join(projectPath, 'visible.txt'), 'work');
  const snapshot = gitSnapshot(projectPath);
  assert.equal(snapshot.dirty, true);
  assert.equal(snapshot.status.includes('private-sibling'), false);
  assert.ok(snapshot.status.endsWith('\0'), 'preserve machine-readable porcelain terminators');
});

test('handoffs default to English and offer Korean without translating saved content', async t => {
  const { store } = fixture(t);
  store.saveCheckpoint({ project: 'demo', profile: 'personal', ...body, goal: '한국어 사용자 작성 목표' });
  const context = { project: 'demo', profile: 'personal' };
  const english = await execute(store, 'handoff_export', context);
  const korean = await execute(store, 'handoff_export', { ...context, language: 'ko' });
  assert.match(english.content, /## Goal/);
  assert.match(korean.content, /## 목표/);
  assert.match(english.content, /한국어 사용자 작성 목표/);
  await assert.rejects(execute(store, 'handoff_export', { ...context, language: 'fr' }));
});
