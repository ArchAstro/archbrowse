import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KittyHost, rpc } from './herdr.js';
import { waitFor, samePixels } from './terminal.js';

const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'archbrowse-headless-herdr-'));
const artifacts=resolve('artifacts','headless-herdr-'+new Date().toISOString().replaceAll(':','-'));await mkdir(artifacts,{recursive:true});
const config=join(root,'herdr.toml');await writeFile(config,'onboarding = false\n[experimental]\nkitty_graphics = true\n');
const name=`ab-bg-${process.pid}-${Date.now()}`;
const env:NodeJS.ProcessEnv={...process.env,HERDR_ENV:'',HERDR_SESSION:'',HERDR_PANE_ID:'',HERDR_SOCKET_PATH:'',HERDR_CONFIG_PATH:config,ARCHBROWSE_SESSIONS_DIR:join(root,'sessions'),TERM:'xterm-ghostty',TERM_PROGRAM:'ghostty'};
for(const key of ['SSH_CONNECTION','SSH_TTY','TMUX','STY','HERDR_REMOTE_KEYBINDINGS'])delete env[key];
const host=new KittyHost(name,env,join(root,'tty'));host.releaseDimensions();let socket='',report='# Headless browser attached through HerdR\n\n';
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
async function cli(args:string[]){const {stdout}=await exec(process.execPath,[resolve('dist/cli.js'),...args],{env,timeout:30000});return JSON.parse(stdout);}
async function command(args:string[]){return (await cli(['--session','work','--json',...args])).result;}
async function capture(slug:string){
  const path=join(artifacts,slug+'-browser.png');
  await waitFor(async()=>{
    if(!host.frame||!host.placement)return false;
    const size=await command(['eval','({width:innerWidth,height:innerHeight})']);
    if(size.width!==host.placement.columns*host.cellWidth||size.height!==host.placement.rows*host.cellHeight)return false;
    await command(['screenshot',path]);return !!host.frame&&samePixels(host.frame,await readFile(path));
  },'background HerdR pixels '+slug);
  await writeFile(join(artifacts,slug+'-terminal.png'),host.frame!);
}
try {
  await waitFor(async()=>{const list=JSON.parse((await exec('herdr',['session','list','--json'],{env})).stdout);socket=list.sessions.find((s:{name:string;running:boolean})=>s.name===name&&s.running)?.socket_path??'';return !!socket;},'isolated HerdR session');
  let pane='';await waitFor(async()=>{pane=(await rpc(socket,'session.snapshot',{})).snapshot.panes[0]?.pane_id??'';return !!pane;},'HerdR pane');
  await cli([resolve('examples/html/index.html'),'--headless','--session','work','--no-install']);
  await command(['eval',"window.marker='background-survives'"]);await command(['click','#counter']);
  const launch=[process.execPath,resolve('dist/cli.js'),'attach','work','--view'].map(quote).join(' ');
  for(let attempt=0;attempt<2;attempt++) {
    await exec('herdr',['pane','run',pane,launch],{env:{...env,HERDR_SOCKET_PATH:socket}});
    await capture('0'+(attempt+1)+'-attached');assert.equal(await command(['eval','window.marker']),'background-survives');
    const box=await command(['eval',`(()=>{const r=document.querySelector('#counter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`]);
    host.click(box.x,box.y);await command(['wait','--text','Count: '+(attempt+2)]);
    await rpc(socket,'pane.send_keys',{pane_id:pane,keys:['ctrl+q']});
    await waitFor(async()=>!(await command(['attach'])).viewerAttached,'HerdR viewer detaches');
    await waitFor(()=>!host.frame,'HerdR image cleared');
    assert.equal(await command(['eval','window.marker']),'background-survives');
  }
  await cli(['sessions','stop','work']);report+='1. Background owner runs without a PTY; two successive real HerdR viewers preserve live state, exact pixels and high-DPI human input.\n\nPASS\n';
  console.log(`PASS: ${artifacts}`);
}catch(error){report+='\nFAIL: '+String(error)+'\n';throw error;}
finally {
  await cli(['sessions','stop','work']).catch(()=>{});
  await writeFile(join(artifacts,'outer-pty.log'),host.output);await writeFile(join(artifacts,'report.md'),report);
  await exec('herdr',['session','stop',name,'--json'],{env}).catch(()=>{});host.pty.kill();await exec('herdr',['session','delete',name,'--json'],{env}).catch(()=>{});
  await rm(root,{recursive:true,force:true,maxRetries:3});
}
