import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Terminal, waitFor, samePixels } from './terminal.js';
const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'starpane-agent-e2e-'));
const env={...process.env,STARPANE_SESSIONS_DIR:join(root,'sessions')};
const artifacts=resolve('artifacts','agent-'+new Date().toISOString().replaceAll(':','-'));await mkdir(artifacts,{recursive:true});
const terminal=new Terminal([resolve('examples/App.tsx'),'--session','work','--no-install'],true,env);
let report='# Live agent attachment\n\n';
async function command(args:string[],name='work') {
  const {stdout}=await exec(process.execPath,[resolve('dist/cli.js'),'--session',name,'--json',...args],{env});
  const reply=JSON.parse(stdout);assert.equal(reply.ok,true);return reply.result;
}
async function rejected(args:string[],code:string,name='work') {
  try{await command(args,name);assert.fail('Expected command to fail');}catch(error){
    const stdout=(error as {stdout?:string}).stdout;if(!stdout)throw error;
    const reply=JSON.parse(stdout);assert.equal(reply.ok,false);assert.equal(reply.error.code,code);
  }
}
async function capture(slug:string) {
  const path=join(artifacts,slug+'-browser.png');await command(['screenshot',path]);const reference=await readFile(path);
  await waitFor(()=>terminal.frames.some(frame=>samePixels(reference,frame)),'agent action visible in terminal');
  await writeFile(join(artifacts,slug+'-terminal.png'),terminal.frames.find(frame=>samePixels(reference,frame))!);
}
try {
  await waitFor(()=>terminal.frames.length>0,'named viewer started');
  const attached=await command(['attach']);assert.equal(attached.session,'work');
  await rejected(['attach'],'session_not_running','missing');
  let snapshot=await command(['snapshot','-i']);assert.ok(snapshot.refs.length>=4);
  const button=snapshot.refs.find((r:{role:string;name:string})=>r.role==='button'&&r.name.startsWith('Launches'));
  const textbox=snapshot.refs.find((r:{role:string})=>r.role==='textbox');assert.ok(button&&textbox);
  await command(['fill',textbox.ref,'Agent controls this']);assert.equal(await command(['get','value',textbox.ref]),'Agent controls this');
  await command(['click',button.ref]);await command(['wait','--text','1 launches']);await capture('01-agent-click');
  report+='1. Separate CLI processes attach, snapshot refs, fill, click and capture the same visible browser.\n';
  const box=await command(['eval',`(()=>{const r=document.querySelector('#counter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`]);
  const waiting=command(['wait','--text','2 launches','--timeout','3000']);
  const clickTimer=setTimeout(()=>{terminal.mouse(0,box.x,box.y);terminal.mouse(0,box.x,box.y,true);},300);
  try{await waiting;}finally{clearTimeout(clickTimer);}
  assert.equal(await command(['get','text','#count']),'2 launches');await capture('02-human-and-agent');
  report+='2. Agent waits allow simultaneous human terminal input; neither launches another browser.\n';
  await command(['reload']);await rejected(['click',button.ref],'stale_ref');
  snapshot=await command(['snapshot','-i']);const old=snapshot.refs[0].ref;await command(['snapshot','-i']);await rejected(['click',old],'stale_ref');
  await command(['eval',`for(let i=0;i<2;i++){const b=document.createElement('button');b.textContent='Duplicate';b.id='dup'+i;b.onclick=()=>document.body.dataset.chosen=String(i);document.body.prepend(b)}`]);
  snapshot=await command(['snapshot','-i']);const duplicates=snapshot.refs.filter((r:{name:string})=>r.name==='Duplicate');assert.equal(duplicates.length,2);
  const originalId=await command(['get','attr',duplicates[0].ref,'id']);
  await command(['eval',`document.body.prepend(document.querySelector('#dup0'))`]);await command(['click',duplicates[0].ref]);
  assert.equal(await command(['eval','document.body.dataset.chosen']),originalId.slice(-1));
  await command(['eval',`document.querySelector('#${originalId}').replaceWith(document.createElement('button'))`]);await rejected(['click',duplicates[0].ref],'stale_ref');
  report+='3. Refs become stale on navigation/re-snapshot/replacement; duplicate labels stay bound to the original element after DOM reordering.\n';
  await rejected(['wait','--text','not present','--timeout','50'],'command_failed');assert.equal((await command(['attach'])).session,'work');
  await command(['reload']);await command(['wait','#counter']);
  const tabs=await command(['tab','list']);assert.equal(tabs.length,1);
  const created=await command(['tab','new',attached.url+'#second']);assert.ok(created.id);
  assert.equal((await command(['tab','list'])).length,2);
  await command(['tab',tabs[0].id]);await command(['tab','close',created.id]);
  report+='4. Tab switching, closing and failed commands preserve the running viewer.\n';
  await terminal.close();assert.equal(terminal.ended,0);await rejected(['attach'],'session_not_running');
  report+='5. Viewer exit removes the control endpoint; agents cannot attach to an inactive saved profile.\n\nPASS\n';
  console.log(`PASS: ${artifacts}`);
} catch(error) {report+=`\nFAIL: ${String(error)}\n`;throw error;}
finally{await writeFile(join(artifacts,'report.md'),report);await writeFile(join(artifacts,'terminal.log'),terminal.transcript);await terminal.close();await rm(root,{recursive:true,force:true});}
