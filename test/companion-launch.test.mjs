import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCompanion } from '../src/companion-launch.mjs';

test('reopen targets the registered app and uses argument-safe open without a model turn', () => {
 const calls=[];
 const result=openCompanion({platform:'darwin',home:'/user',exists:()=>true,exec:(cmd,args)=>{
  calls.push({cmd,args});
  if(args[1]==='Print :ProgramArguments:0')return '/project with spaces/CDX Slider.app/Contents/MacOS/SliderBar\n';
  if(args[1]==='Print :CFBundleIdentifier')return 'local.cdx-slider.companion\n';
  return '';
 }});
 assert.deepEqual(calls.at(-1),{cmd:'/usr/bin/open',args:['/project with spaces/CDX Slider.app']});
 assert.equal(result.status,'requested');
});
test('missing or mismatched applications never open another app', () => {
 let opened=false;
 assert.throws(()=>openCompanion({platform:'darwin',exists:()=>true,exec:(cmd,args)=>{
  if(cmd==='/usr/bin/open')opened=true;
  return args[1]==='Print :ProgramArguments:0' ? '/wrong.app/Contents/MacOS/SliderBar' : 'other.bundle';
 }}),/was not found/);
 assert.equal(opened,false);
 assert.throws(()=>openCompanion({platform:'linux'}),/macOS/);
});
