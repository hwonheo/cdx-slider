// Development-only mock host. No database access and no actual conversation writes.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const checkpoint = JSON.parse(readFileSync(new URL('../examples/checkpoint.json', import.meta.url), 'utf8'));
// Reuse the English public example; escape '<' before embedding JSON in HTML.
const previewCheckpoint = JSON.stringify({ ...checkpoint, id: 'fixture', createdAt: '2026-09-18T16:34:00Z' }).replaceAll('<', '\\u003c');
const host = `<!doctype html><html lang="en"><meta charset="utf-8"><title>CDX Slider panel preview</title>
<style>body{margin:0;padding:32px 16px;background:#edf1f7;font-family:system-ui;color:#17243a}h1,p{max-width:660px;margin:0 auto 16px}h1{font-size:16px}p{font-size:12px;color:#637086}iframe{display:block;width:min(100%,660px);height:620px;margin:auto;border:1px solid #dce3ed;border-radius:14px;background:white}pre{max-width:660px;white-space:pre-wrap;margin:16px auto;font-size:12px}</style>
<h1>CDX Slider · UI preview</h1><p>Mock host connection. No real conversations or checkpoints are saved.</p>
<iframe id="panel" src="/panel.html" title="CDX Slider"></iframe><pre id="messages"></pre>
<script>
const frame=document.getElementById('panel');
const projects=[{id:'cdx-slider',name:'CDX Slider',path:'/Users/example/GitHub/cdx-slider'}];
const flags=new URLSearchParams(location.search);
let displayMode='inline';
let login={status:'idle'},restart={status:'idle',supported:true};
function notify(method,params){frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},location.origin)}
window.addEventListener('message',e=>{
 if(e.source!==frame.contentWindow||e.origin!==location.origin)return;
 const m=e.data;if(!m||m.jsonrpc!=='2.0')return;
 let result;
 if(m.method==='ui/initialize') result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'CDX Slider mock host',version:'1'},hostCapabilities:{serverTools:{},...(flags.has('unsupported')?{}:{message:{text:{}}})},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:flags.has('pip')?['inline','pip']:['inline']}};
 else if(m.method==='ui/notifications/initialized') {notify('ui/notifications/tool-result',{content:[],structuredContent:{profiles:[{id:'desktop',label:'desktop'}],selectedProfile:'desktop',selectedProject:'cdx-slider',contextPath:projects[0].path,suggestedName:'CDX Slider',suggestedId:'cdx-slider'}});return;}
 else if(m.method==='ui/request-display-mode') {
   displayMode=flags.has('pip')&&!flags.has('deny-pip')?m.params.mode:'inline';
   frame.style.width=displayMode==='pip'?'360px':'min(100%,660px)';
   result={mode:displayMode};
   notify('ui/notifications/host-context-changed',{displayMode});
 } else if(m.method==='ui/notifications/size-changed') {
   if(displayMode==='pip') frame.style.height=Math.min(m.params.height||520,560)+'px';
   return;
 } else if(m.method==='tools/call'){
   let data;
   if(m.params.name==='companion_open') data={status:'requested',message:'Requested CDX Slider Bar display.'};
   else if(m.params.name==='restart_status') data=restart;
   else if(m.params.name==='restart_schedule') data=restart={status:'scheduled',supported:true,restartAt:Date.now()+15000};
   else if(m.params.name==='restart_cancel') data=restart={status:'cancelled',supported:true};
   else if(m.params.name==='workspace_read') data={status:'ok',workspace:{id:'demo-workspace-001',name:null},checkedAt:new Date().toISOString()};
   else if(m.params.name==='login_status') data=login;
   else if(m.params.name==='login_start') data=login={status:'pending',sessionId:'00000000-0000-4000-8000-000000000001',authUrl:'https://auth.openai.com/'};
   else if(m.params.name==='login_cancel') data=login={status:'cancelled'};
   else if(m.params.name==='account_read') data={status:'ok',account:{email:'demo@example.com',planType:'plus'},checkedAt:new Date().toISOString(),source:'local-codex',workspace:null,desktopAccountVerified:false};
   else if(m.params.name==='projects_list') data={projects};
   else if(m.params.name==='project_register'){projects.push({id:m.params.arguments.project,name:m.params.arguments.name,path:m.params.arguments.path});data=projects.at(-1)}
   else if(m.params.name==='project_resume') data={checkpoint:${previewCheckpoint}};
   else {result={isError:true,content:[{type:'text',text:'Mock host does not support this tool'}]};}
   if(data)result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
 } else if(m.method==='ui/message'){document.getElementById('messages').textContent=m.params.content[0].text;result={isError:flags.has('reject')}}
 else if(m.id!==undefined) result={};
 if(m.id!==undefined)frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},location.origin);
});
</script></html>`;
const server = createServer((req, res) => {
  if (req.url === '/panel.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(new URL('../dist/panel.html', import.meta.url))); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(host); }
});
server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}`));
