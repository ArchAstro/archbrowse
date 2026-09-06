import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Terminal, waitFor, samePixels } from './terminal.js';

const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'archbrowse-headless-'));
const sourceRoot=await mkdtemp(resolve('test/generated-headless-'));
const env={...process.env,ARCHBROWSE_SESSIONS_DIR:join(root,'sessions')};
const artifacts=resolve('artifacts','headless-'+new Date().toISOString().replaceAll(':','-'));await mkdir(artifacts,{recursive:true});
const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><style>body{margin:40px;font:20px sans-serif}button,input{padding:20px;margin:20px}</style><h1>Background browser</h1><button id="counter">Count: 0</button><input id="name" aria-label="Name"><script>window.live=crypto.randomUUID();let count=0;document.querySelector('#counter').onclick=()=>{document.querySelector('#counter').textContent='Count: '+(++count);localStorage.setItem('count',count)}</script>`));
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
const viewers:Terminal[]=[];const names=new Set<string>();let report='# Background sessions and detachable viewers\n\n';
async function cli(args:string[]){const {stdout}=await exec(process.execPath,[resolve('dist/cli.js'),...args],{env,timeout:45000});return JSON.parse(stdout);}
async function command(args:string[],name='work'){const reply=await cli(['--session',name,'--json',...args]);assert.equal(reply.ok,true);return reply.result;}
async function start(name:string,target=url,mobile=false){names.add(name);const reply=await cli([target,'--headless','--session',name,'--no-install',...(mobile?['--mobile']:[])]);assert.equal(reply.ok,true);assert.equal(reply.result.mode,'background');return reply.result;}
async function capture(viewer:Terminal,slug:string,name='work'){
  const path=join(artifacts,slug+'-browser.png');
  await waitFor(async()=>{await command(['screenshot',path],name);const image=await readFile(path);return viewer.frames.some(frame=>samePixels(frame,image));},'viewer/browser pixel parity '+slug);
  const image=await readFile(path);await writeFile(join(artifacts,slug+'-terminal.png'),viewer.frames.find(frame=>samePixels(frame,image))!);
}
async function attach(name='work',pixel=true){const viewer=new Terminal(['attach',name,'--view','--fps','15'],pixel,env);viewers.push(viewer);await waitFor(()=>viewer.frames.length>0,'background viewer first frame');return viewer;}
async function detached(name='work'){await waitFor(async()=>!(await command(['attach'],name)).viewerAttached,'viewer lease released');}
async function step(label:string,fn:()=>Promise<void>){console.log(label);await fn();report+='1. '+label+'\n';}
try{
  let identity:string,pid:number;
  await step('Start without a PTY, return to caller, and drive a live browser',async()=>{
    const result=await start('work');pid=result.pid;assert.equal(result.viewerAttached,false);
    identity=await command(['eval','window.live']);assert.ok(identity);
    const snapshot=await command(['snapshot','-i']);assert.ok(snapshot.refs.some((r:{name:string})=>r.name==='Count: 0'));
    await command(['click','#counter']);assert.equal(await command(['get','text','#counter']),'Count: 1');
    await command(['fill','#name','Agent before viewer']);
    assert.equal((await command(['attach'])).pid,pid);
    await assert.rejects(()=>start('work'));
  });
  let first:Terminal;
  await step('Attach a real PTY, preserve DOM state, and share human/agent input',async()=>{
    first=await attach();assert.equal(await command(['eval','window.live']),identity!);
    assert.equal(await command(['get','value','#name']),'Agent before viewer');
    const box=await command(['eval',`(()=>{const r=document.querySelector('#counter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`]);
    first.mouse(0,box.x,box.y);first.mouse(0,box.x,box.y,true);await command(['wait','--text','Count: 2']);
    await capture(first,'01-attached');
    const second=new Terminal(['attach','work','--view'],true,env);viewers.push(second);await waitFor(()=>second.ended!==undefined,'second viewer rejected');assert.equal(second.ended,1);assert.match(second.transcript,/already attached/);
    first.resize(110,42);await command(['wait','#counter']);await waitFor(async()=>await command(['eval','innerWidth'])===880,'viewer resize');await capture(first,'02-resize');
  });
  await step('Detach and reattach without losing live JavaScript state',async()=>{
    await first!.close();await detached();assert.equal((await command(['attach'])).pid,pid!);
    await command(['click','#counter']);assert.equal(await command(['get','text','#counter']),'Count: 3');assert.equal(await command(['eval','window.live']),identity!);
    const next=await attach('work',false);await capture(next,'03-reattached');
    const box=await command(['eval',`(()=>{const r=document.querySelector('#counter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`]);
    next.mouse(0,box.x,box.y);next.mouse(0,box.x,box.y,true);await command(['wait','--text','Count: 4']);
    await command(['eval',"window.releaseCount=0;window.downCount=0;addEventListener('mouseup',()=>window.releaseCount++);addEventListener('mousedown',()=>window.downCount++)"]);
    next.mouse(0,box.x,box.y);await waitFor(async()=>await command(['eval','window.downCount'])===1,'mouse held');
    next.pty.kill('SIGKILL');await waitFor(()=>next.ended!==undefined,'viewer killed');await detached();assert.equal(await command(['eval','window.live']),identity!);
    assert.equal(await command(['eval','window.releaseCount']),1);
    const recovered=await attach();await capture(recovered,'04-after-viewer-crash');await recovered.close();await detached();
  });
  await step('A mobile React session can be controlled before and after viewer attachment',async()=>{
    await start('mobile',resolve('examples/App.tsx'),true);
    assert.equal(await command(['eval','innerWidth'],'mobile'),390);
    await command(['eval',"window.backgroundMarker='preserved'"],'mobile');
    const mobile=await attach('mobile');await capture(mobile,'05-mobile','mobile');
    assert.equal(await command(['eval','window.backgroundMarker'],'mobile'),'preserved');
    const box=await command(['eval',`(()=>{const r=document.querySelector('#counter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`],'mobile');
    const scale=Math.min(mobile.cols*8/390,mobile.rows*16/844);
    const x=box.x*(Math.floor(390*scale/8)*8/390),y=box.y*(Math.floor(844*scale/16)*16/844);
    mobile.mouse(0,x,y);mobile.mouse(0,x,y,true);await command(['wait','--text','1 launches'],'mobile');
    await command(['focus','#name'],'mobile');mobile.write('\x1b[200~Mobile 🌙\x1b[201~');await command(['wait','--text','Hello, Mobile 🌙.'],'mobile');
    await mobile.close();await detached('mobile');
    assert.equal(await command(['eval','window.backgroundMarker'],'mobile'),'preserved');
  });
  await step('Agent file edits reload a headless React entry without a terminal',async()=>{
    const file=join(sourceRoot,'App.tsx');await writeFile(file,`export default function App(){return <h1>Before edit</h1>}`);
    await start('editing',file);await command(['wait','--text','Before edit'],'editing');
    await writeFile(file,`export default function App(){return <h1>After edit</h1>}`);
    await command(['wait','--text','After edit'],'editing');
  });
  await step('Stop closes attached viewers, releases the profile, and permits restart',async()=>{
    const viewer=await attach();await cli(['sessions','stop','work']);await waitFor(()=>viewer.ended!==undefined,'owner stop closes viewer');assert.equal(viewer.ended,0);
    assert.equal((await cli(['sessions','list','--json'])).find((s:{name:string})=>s.name==='work').active,false);
    await start('work');assert.notEqual(await command(['eval','window.live']),identity!);assert.equal(await command(['eval',"localStorage.getItem('count')"]),'4');
  });
  await step('Failed startup returns an error and does not hold the session lock',async()=>{
    names.add('bad');await assert.rejects(()=>cli([join(root,'missing.tsx'),'--headless','--session','bad','--no-install']));
    await waitFor(async()=>!(await cli(['sessions','list','--json'])).find((s:{name:string})=>s.name==='bad')?.active,'failed startup releases lock');
  });
  report+='\nPASS\n';console.log(`PASS: ${artifacts}`);
}catch(error){report+='\nFAIL: '+String(error)+'\n';throw error;}
finally{
  for(const name of names)await cli(['sessions','stop',name]).catch(()=>{});
  for(const [i,viewer] of viewers.entries()){await viewer.close().catch(()=>{});await writeFile(join(artifacts,`viewer-${i}.log`),viewer.transcript);}
  await writeFile(join(artifacts,'report.md'),report);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(root,{recursive:true,force:true,maxRetries:3});await rm(sourceRoot,{recursive:true,force:true});
}
