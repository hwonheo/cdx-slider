import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDisplayController } from '../ui/display.mjs';

test('unsupported or refused PiP keeps full panel accessible', async () => {
  let calls=0,state;
  const controller=createDisplayController({requestDisplayMode:async()=>{calls++;return {mode:'inline'};}},next=>state=next);
  controller.update({availableDisplayModes:['inline']});
  await controller.float();assert.equal(calls,0);assert.equal(state.compact,false);
  controller.update({availableDisplayModes:['inline','pip']});
  await controller.float();assert.equal(calls,1);assert.equal(state.compact,false);assert.ok(state.error);
});

test('expanding and collapsing PiP is local and host changes restore full panel', async () => {
  let calls=0,state;
  const controller=createDisplayController({requestDisplayMode:async({mode})=>{calls++;return {mode};}},next=>state=next);
  controller.update({availableDisplayModes:['inline','pip'],displayMode:'inline'});
  await controller.float();assert.equal(state.compact,true);
  controller.expand();assert.equal(state.compact,false);assert.equal(state.mode,'pip');
  controller.update({theme:'dark'});assert.equal(state.compact,false);
  controller.update({displayMode:'pip'});assert.equal(state.compact,false);
  await controller.float();assert.equal(state.compact,true);assert.equal(calls,1);
  await controller.inline();assert.equal(state.compact,false);assert.equal(state.mode,'inline');
  controller.update({displayMode:'pip'});assert.equal(state.compact,true);
  controller.update({displayMode:'inline'});assert.equal(state.compact,false);
});

test('concurrent requests are suppressed and transport errors preserve current layout', async () => {
  let reject,state,calls=0;
  const controller=createDisplayController({requestDisplayMode:()=>{calls++;return new Promise((_,r)=>reject=r);}},next=>state=next);
  controller.update({availableDisplayModes:['pip','inline']});
  const pending=controller.float();await controller.float();assert.equal(calls,1);assert.equal(state.busy,true);
  reject(Error('disconnected'));await pending;
  assert.equal(state.compact,false);assert.equal(state.busy,false);assert.ok(state.error);
});
