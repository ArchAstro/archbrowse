import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KittyHost, rpc } from './herdr.js';
import { waitFor } from './terminal.js';
import { status } from '../../skills/archbrowse/scripts/bootstrap.mjs';
import { savePreferences, planLaunch } from '../../skills/archbrowse/scripts/preferences.mjs';
const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'archbrowse-skill-e2e-'));
const artifacts=resolve('artifacts','skill-'+new Date().toISOString().replaceAll(':','-'));await mkdir(artifacts,{recursive:true});
const installed=await status();assert.equal(installed.installed,true,'Run bootstrap install before the skill integration test.');
const config=join(root,'herdr.toml');await writeFile(config,'onboarding = false\n[experimental]\nkitty_graphics = true\n');
const name=`sp-skill-${process.pid}-${Date.now()}`;
const env:NodeJS.ProcessEnv={...process.env,HERDR_ENV:'',HERDR_SESSION:'',HERDR_PANE_ID:'',HERDR_SOCKET_PATH:'',HERDR_CONFIG_PATH:config,ARCHBROWSE_SESSIONS_DIR:join(root,'sessions'),ARCHBROWSE_PREFERENCES_FILE:join(root,'preferences.json'),TERM:'xterm-ghostty',TERM_PROGRAM:'ghostty'};
for(const key of ['SSH_CONNECTION','SSH_TTY','TMUX','STY','HERDR_REMOTE_KEYBINDINGS'])delete env[key];
const host=new KittyHost(name,env);let socket='',report='# ArchBrowse skill workflow\n\n';
const command=installed.command!;
async function archbrowse(args:string[]){return JSON.parse((await exec(command[0],[...command.slice(1),...args,'--json'],{env})).stdout);}
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
try {
  await waitFor(async()=>{const list=JSON.parse((await exec('herdr',['session','list','--json'],{env})).stdout);socket=list.sessions.find((s:{name:string;running:boolean})=>s.name===name&&s.running)?.socket_path??'';return !!socket;},'skill test HerdR session');
  let snapshot:any;await waitFor(async()=>{snapshot=(await rpc(socket,'session.snapshot',{})).snapshot;return !!snapshot.panes[0];},'caller pane');
  const caller=snapshot.panes[0],context={...env,HERDR_ENV:'1',HERDR_SOCKET_PATH:socket,HERDR_WORKSPACE_ID:caller.workspace_id,HERDR_PANE_ID:caller.pane_id};
  for(const placement of ['split','tab']){
    await savePreferences({host:'herdr',placement,sessionPolicy:'workspace',focus:'keep'},{env:context});
    const plan=await planLaunch(process.cwd(),{},context);assert.equal(plan.status,'ready');
    let pane:string,tab:string|undefined;
    if(placement==='split'){
      const result=JSON.parse((await exec('herdr',['pane','split',caller.pane_id,'--direction','right','--cwd',plan.workspace,'--no-focus'],{env:context})).stdout);pane=result.result.pane.pane_id;
    }else{
      const result=JSON.parse((await exec('herdr',['tab','create','--workspace',caller.workspace_id,'--cwd',plan.workspace,'--label','ArchBrowse','--no-focus'],{env:context})).stdout);pane=result.result.root_pane.pane_id;tab=result.result.tab.tab_id;
    }
    const launch=[...command,resolve('examples/html/index.html'),'--session',plan.session,'--no-install'].map(quote).join(' ');
    await exec('herdr',['pane','run',pane,launch],{env:context});
    await waitFor(async()=>{try{return (await archbrowse(['--session',plan.session,'attach'])).ok;}catch{return false;}},'installed ArchBrowse ready in preferred location',20000);
    const tree=await archbrowse(['--session',plan.session,'snapshot','-i']);assert.ok(tree.result.refs.some((ref:{name:string})=>ref.name==='Count: 0'));
    const after=(await rpc(socket,'session.snapshot',{})).snapshot;assert.equal(after.focused_pane_id,caller.pane_id,'focus kept with caller');
    const same=await planLaunch(process.cwd(),{},context);assert.equal(same.session,plan.session);assert.equal((await archbrowse(['--session',same.session,'attach'])).ok,true);
    report+=`1. Saved ${placement} preference creates the requested HerdR layout, keeps focus, and launches the installed CLI; replanning reuses the same live session.\n`;
    await rpc(socket,'pane.send_keys',{pane_id:pane,keys:['ctrl+q']});
    await waitFor(async()=>{try{await archbrowse(['--session',plan.session,'attach']);return false;}catch{return true;}},'viewer closed');
    await exec('herdr',tab?['tab','close',tab]:['pane','close',pane],{env:context});
  }
  report+='\nPASS\n';console.log(`PASS: ${artifacts}`);
}catch(error){report+=`\nFAIL: ${String(error)}\n`;throw error;}
finally{
  await writeFile(join(artifacts,'report.md'),report);await writeFile(join(artifacts,'outer-pty.log'),host.output);
  await exec('herdr',['session','stop',name,'--json'],{env}).catch(()=>{});host.pty.kill();await exec('herdr',['session','delete',name,'--json'],{env}).catch(()=>{});await rm(root,{recursive:true,force:true});
}
