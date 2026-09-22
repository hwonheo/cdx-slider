import { bootstrapAgent } from './launch-agent.mjs';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw Error('macOS only');
const label='local.cdx-slider.companion';
const directory=join(homedir(),'Library','LaunchAgents');
const plist=join(directory,`${label}.plist`);
const target=`gui/${process.getuid()}/${label}`;
const appIndex=process.argv.indexOf('--app');
if(appIndex!==-1 && (!process.argv[appIndex+1] || process.argv[appIndex+1].startsWith('--')))throw Error('--app requires an application path');
const executable=join(resolve(appIndex===-1 ? 'dist/CDX Slider.app' : process.argv[appIndex+1]),'Contents/MacOS/SliderBar');
const run=(...args)=>execFileSync('/bin/launchctl',args,{stdio:['ignore','pipe','pipe']});
const unload=()=>{try{run('bootout',target);}catch(error){if(error.status!==3&&error.status!==113)throw error;}};
if(process.argv.includes('--uninstall')){
 unload();rmSync(plist,{force:true});console.log('Automatic Codex lifecycle connection removed. App and project data retained.');
}else{
 if(!existsSync(executable))throw Error('Run npm run build:companion first.');
 const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 mkdirSync(directory,{recursive:true});
 const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
 <key>Label</key><string>${label}</string>
 <key>ProgramArguments</key><array><string>${escape(executable)}</string></array>
 <key>RunAtLoad</key><true/>
 <key>LimitLoadToSessionType</key><string>Aqua</string>
 <key>ProcessType</key><string>Interactive</string>
 </dict></plist>`;
 // No KeepAlive: an explicit Quit must stay quit until next login/manual launch.
 unload();writeFileSync(plist,xml,{mode:0o600});bootstrapAgent(run,`gui/${process.getuid()}`,plist);
 console.log(`Registered: ${plist}`);
 console.log(run('print',target).toString().split('\n').filter(l=>/state =|pid =/.test(l)).join('\n'));
}
