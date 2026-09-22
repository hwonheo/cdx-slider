import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Relay } from '../src/relay.mjs';
import { relayTick } from '../ui/relay.mjs';

test('built MCP server and separate queue connection deliver one panel request through MCP', async t => {
  const root=mkdtempSync(join(tmpdir(),'slider-relay-mcp-'));
  const home=join(root,'data'), projectPath=join(root,'project');mkdirSync(projectPath);
  const client=new Client({name:'relay-integration',version:'1'});
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/server.mjs')],
    env:{PATH:process.env.PATH,CDX_SLIDER_HOME:home},stderr:'pipe'}));
  const tool=async(name,args)=>{
    const r=await client.callTool({name,arguments:args});
    if(r.isError)throw Error(r.content[0].text);
    return r.structuredContent;
  };
  let queue;
  try {
    await tool('profile_register',{id:'desktop',label:'Test'});
    await tool('project_register',{profile:'desktop',project:'demo',name:'Test',path:projectPath});
    const target={profile:'desktop',project:'demo',threadId:randomUUID()};
    const {relay:channel}=await tool('slider_panel',target);
    const metadata=(await client.listTools()).tools;
    assert.deepEqual(metadata.find(t=>t.name==='relay_poll')._meta.ui.visibility,['app']);
    await tool('relay_poll',{token:channel.token,profile:'desktop',project:'demo'});
    queue=new Relay(home);
    const request=queue.enqueue(target);let sent=0;
    await relayTick({channel,tool,isCurrent:()=>true,report:()=>{},bridge:{
      getHostCapabilities:()=>({message:{text:{}}}),sendMessage:async()=>{sent++;return {};}
    }});
    assert.equal(sent,1);
    assert.equal(queue.status({...target,...request}).status,'accepted');
    const again=await tool('relay_poll',{token:channel.token,profile:'desktop',project:'demo'});
    assert.equal(again.request,null);
  } finally {queue?.close();await client.close();}
});
