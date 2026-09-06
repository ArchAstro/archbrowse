import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Terminal, waitFor, samePixels } from './terminal.js';
const exec=promisify(execFile);
const root=await mkdtemp(join(tmpdir(),'archbrowse-persistent-e2e-'));
const env={...process.env,ARCHBROWSE_SESSIONS_DIR:join(root,'sessions')};
const artifacts=resolve('artifacts',`sessions-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(artifacts,{recursive:true});
const reports:{origin:string;count:number;cookie:string;idb:number;path:string}[]=[];
const telemetry=createServer((req,res)=> {
  res.setHeader('Access-Control-Allow-Origin','*');
  const data=new URL(req.url!,'http://localhost').searchParams.get('data');
  if(data) reports.push(JSON.parse(data));
  res.end('ok');
});
await new Promise<void>(yes=>telemetry.listen(0,'127.0.0.1',yes));
const address=telemetry.address();assert.ok(address && typeof address!=='string');
const collector=`http://127.0.0.1:${address.port}/`;
await writeFile(join(root,'app.html'),`<!doctype html><meta charset="utf-8"><style>body{background:#101516;color:#d7ff89;font:24px Arial;padding:20px}button{font:inherit;padding:20px}#status{overflow-wrap:anywhere;font-size:16px}</style><h1>Persistent session</h1><button id="save">Save state</button><p id="status"></p><a href="next.html" target="_blank" style="position:absolute;left:300px;top:170px">Next page</a><script>
(async()=> {
 const database=await new Promise((ok,no)=>{ const r=indexedDB.open('state',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error); });
 async function report(){const idb=await new Promise(ok=>{const r=database.transaction('values').objectStore('values').get('count');r.onsuccess=()=>ok(r.result||0)});const data={origin:location.origin,path:location.pathname,count:Number(localStorage.getItem('count')||0),cookie:document.cookie,idb};document.querySelector('#status').textContent=JSON.stringify(data);await fetch(${JSON.stringify(collector)}+'?data='+encodeURIComponent(JSON.stringify(data)));}
 document.querySelector('#save').onclick=async()=>{ const n=Number(localStorage.getItem('count')||0)+1;localStorage.setItem('count',String(n));document.cookie='sessionCount='+n+';path=/';document.cookie='durableCount='+n+';max-age=86400;path=/';await new Promise(ok=>{const t=database.transaction('values','readwrite');t.objectStore('values').put(n,'count');t.oncomplete=ok});await report();};await report();
})();</script>`);
await writeFile(join(root,'next.html'),`<!doctype html><h1>Restored page</h1><script>fetch(${JSON.stringify(collector)}+'?data='+encodeURIComponent(JSON.stringify({origin:location.origin,path:location.pathname,count:Number(localStorage.getItem('count')||0),cookie:document.cookie,idb:-1})))</script>`);
const terminals:Terminal[]=[];
let report='# Persistent named sessions\n\n';
function launch(args:string[]) { const t=new Terminal([...args,'--no-install'],true,env);terminals.push(t);return t; }
async function cli(args:string[]) { return (await exec(process.execPath,[resolve('dist/cli.js'),...args],{env})).stdout; }
async function stateAfter(t:Terminal,index:number) {await waitFor(()=>reports.length>index,'page reported persisted state');await waitFor(()=>t.frames.length>0,'Kitty frame');return reports.at(-1)!;}
try {
  let index=reports.length;
  let terminal=launch([join(root,'app.html'),'--session','work']);
  let state=await stateAfter(terminal,index);assert.equal(state.count,0);const origin=state.origin;
  const listed=JSON.parse(await cli(['sessions','list','--json']));assert.equal(listed[0].active,true);
  const duplicate=launch(['--session','work']);await waitFor(()=>duplicate.ended!==undefined,'concurrent CLI refused');assert.equal(duplicate.ended,1);assert.match(duplicate.transcript,/in use/);
  await assert.rejects(()=>cli(['sessions','delete','work']));
  index=reports.length;terminal.mouse(0,100,180);terminal.mouse(0,100,180,true);
  await waitFor(()=>reports.length>index && reports.at(-1)!.count===1,'save via terminal click');
  assert.equal(reports.at(-1)!.idb,1);
  await writeFile(join(artifacts,'01-saved.png'),terminal.frames.at(-1)!);
  await terminal.close();assert.equal(terminal.ended,0);report+='1. Named CLI saves cookies, localStorage and IndexedDB; duplicate use and active deletion refused.\n';
  index=reports.length;terminal=launch(['--session','work']);state=await stateAfter(terminal,index);
  assert.equal(state.origin,origin);assert.equal(state.count,1);assert.equal(state.idb,1);assert.match(state.cookie,/sessionCount=1/);assert.match(state.cookie,/durableCount=1/);
  await writeFile(join(artifacts,'02-restored.png'),terminal.frames.at(-1)!);
  index=reports.length; terminal.mouse(0,350,180);terminal.mouse(0,350,180,true);
  await waitFor(()=>reports.length>index && reports.at(-1)!.path==='/next.html','new persistent tab');
  await waitFor(async()=>(await cli(['--session','work','get','url'])).trim().endsWith('/next.html'),'popup is the active tab');
  const activePath=join(artifacts,'active-tab-reference.png');
  await cli(['--session','work','screenshot',activePath]);
  const activeFrame=await readFile(activePath);
  await waitFor(()=>terminal.frames.some(frame=>samePixels(frame,activeFrame)),'active tab frame rendered');
  await terminal.close();
  const tabRecord=JSON.parse(await readFile(join(root,'sessions/work/session.json'),'utf8'));
  assert.equal(tabRecord.tabs.length,2);assert.equal(tabRecord.activeTab,1);
  index=reports.length;terminal=launch(['--session','work']);
  await stateAfter(terminal,index);
  await waitFor(()=>terminal.frames.some(frame=>samePixels(frame,activeFrame)),'restored active tab pixels');
  await terminal.close();
  report+='2. A fresh CLI/browser process restores the origin, stored values, both tabs and the active tab pixels.\n';
  index=reports.length;terminal=launch([join(root,'app.html'),'--session','other']);state=await stateAfter(terminal,index);
  assert.equal(state.count,0);assert.equal(state.idb,0);assert.equal(state.cookie,'');await terminal.close();report+='3. A different named profile has no shared state.\n';
  // Reopen the same profile with another URL, then resume without an entry argument.
  index=reports.length;terminal=launch([join(root,'next.html'),'--session','work']);state=await stateAfter(terminal,index);assert.equal(state.count,1);assert.equal(state.path,'/next.html');await terminal.close();
  index=reports.length;terminal=launch(['--session','work']);state=await stateAfter(terminal,index);assert.equal(state.path,'/next.html');await terminal.close();report+='4. The saved target reopens without repeating a file or URL.\n';
  const metadata=JSON.parse(await readFile(join(root,'sessions/work/session.json'),'utf8'));assert.equal(metadata.tabs.length,1);assert.equal(metadata.tabs[0],origin+'/next.html');
  await cli(['sessions','delete','work']);assert.equal(JSON.parse(await cli(['sessions','list','--json'])).some((s:{name:string})=>s.name==='work'),false);
  index=reports.length;terminal=launch([join(root,'app.html'),'--session','work']);state=await stateAfter(terminal,index);assert.equal(state.count,0);assert.equal(state.cookie,'');assert.equal(state.idb,0);await terminal.close();report+='5. Deletion removes state; reusing the name starts clean.\n\nPASS\n';
  console.log(`PASS: ${artifacts}`);
} catch(error) {report+=`\nFAIL: ${String(error)}\n`;throw error;}
finally {
  await writeFile(join(artifacts,'report.md'),report);
  for(let i=0;i<terminals.length;i++) { await writeFile(join(artifacts,`terminal-${i}.log`),terminals[i].transcript); if(terminals[i].frames.length) await writeFile(join(artifacts,`terminal-${i}.png`),terminals[i].frames.at(-1)!); }
  await Promise.allSettled(terminals.map(t=>t.close()));
  telemetry.closeAllConnections();await new Promise<void>(r=>telemetry.close(()=>r()));
  await rm(root,{recursive:true,force:true});
}
