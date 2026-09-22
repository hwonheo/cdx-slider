import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Relay } from '../src/relay.mjs';
import { relayTick } from '../ui/relay.mjs';
import { Companion } from '../src/companion.mjs';

const target = { profile:'desktop', project:'demo', threadId:'task-a' };
function setup(t) {
  const home = mkdtempSync(join(tmpdir(),'slider-relay-'));
  let time = Date.now();
  const a = new Relay(home, () => time), b = new Relay(home, () => time);
  t.after(() => { a.close(); b.close(); rmSync(home,{recursive:true,force:true}); });
  const channel = a.open(target);
  return {a,b,home,channel,advance:n=>{time+=n;}};
}
test('minibar backend -> shared queue -> panel -> host -> status, without writer calls', async t => {
  const {a,b,home,channel} = setup(t);
  a.poll(channel);
  const calls=[];
  const companion=new Companion({home, project:()=>({path:'/project'}), resume:()=>({checkpoint:{id:'saved'}})},
    {request:async(method)=>{calls.push(method);return {thread:{id:target.threadId,cwd:'/project'}};}});
  companion.settings.bindings['desktop/demo']={id:target.threadId};
  const queued=await companion.handle({action:'relay-resume',...target});
  const duplicate=await companion.handle({action:'relay-resume',...target});
  assert.equal(duplicate.requestId,queued.requestId);
  const messages=[];
  const bridge={getHostCapabilities:()=>({message:{text:{}}}),sendMessage:async p=>{messages.push(p);return {};}};
  const tool=async(name,args)=>name==='relay_poll'?b.poll(args):b.ack(args);
  await relayTick({bridge,tool,channel,isCurrent:()=>true,report:()=>{}});
  await relayTick({bridge,tool,channel,isCurrent:()=>true,report:()=>{}});
  assert.equal(messages.length,1);
  assert.match(messages[0].content[0].text,/project_resume/);
  assert.match(messages[0].content[0].text,/Do not implement changes or edit files/);
  assert.equal((await companion.handle({action:'relay-status',...target,requestId:queued.requestId})).status,'accepted');
  assert.ok(calls.every(c=>c==='thread/read'));
});
test('unready, wrong target, stale and replaced panels cannot receive new requests', t=>{
  const {a,b,channel,advance}=setup(t);
  assert.throws(()=>a.enqueue(target),/not responding/);
  a.poll(channel);
  assert.throws(()=>a.enqueue({...target,threadId:'task-b'}),/not responding/);
  assert.throws(()=>b.poll({...channel,project:'other'}),/connection changed/);
  advance(6001);assert.throws(()=>a.enqueue(target),/not responding/);
  a.open(target);assert.throws(()=>b.poll(channel),/connection changed/);
});
test('claim is at most once across clients; stale queued requests expire', t=>{
  const {a,b,channel,advance}=setup(t);
  a.poll(channel);const q=a.enqueue(target);
  assert.equal(a.poll(channel).request.id,q.requestId);
  assert.equal(b.poll(channel).request,null);
  advance(21000);
  assert.equal(a.status({...target,...q}).status,'unknown');
  a.poll(channel);advance(10000);a.poll(channel);
  const q2=a.enqueue(target);advance(16000);
  assert.equal(b.poll(channel).request,null);
  assert.equal(a.status({...target,...q2}).status,'expired');
});
test('host timeouts and changed selection do not retry or report accepted', async t=>{
  const {a,b,channel}=setup(t);
  const tool=async(name,args)=>name==='relay_poll'?b.poll(args):b.ack(args);
  a.poll(channel);const q=a.enqueue(target);let sends=0;
  const bridge={getHostCapabilities:()=>({message:{text:{}}}),sendMessage:async()=>{sends++;throw Error('lost acknowledgement');}};
  const tick=current=>relayTick({bridge,tool,channel,isCurrent:()=>current,report:()=>{}});
  await tick(true);await tick(true);
  assert.equal(sends,1);assert.equal(a.status({...target,...q}).status,'unknown');
  const q2=a.enqueue(target);await tick(false);
  assert.equal(sends,1);assert.equal(a.status({...target,...q2}).status,'rejected');
});
