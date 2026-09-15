/** Installed CLI smoke on native OS runners. HerdR uses the existing independent Kitty receiver. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { KittyHost, rpc } from './herdr.js';
import { waitFor, samePixels } from './terminal.js';
import { spawn as spawnPty } from 'node-pty';

const exec = promisify(execFile), herdr = process.argv.includes('--herdr');
const root = await mkdtemp(join(tmpdir(), 'archbrowse platform '));
const artifacts = resolve('artifacts', `platform-${process.platform}-${herdr ? 'herdr' : 'cli'}`);
await mkdir(artifacts, { recursive: true });
const env:NodeJS.ProcessEnv = { ...process.env, ARCHBROWSE_INSTALL_DIR:join(root, 'install'),
  ARCHBROWSE_BIN_DIR:join(root, 'bin'), ARCHBROWSE_SESSIONS_DIR:join(root, 'sessions') };
for (const key of Object.keys(env)) if (key.startsWith('HERDR_')) delete env[key];
for (const key of ['SSH_CONNECTION', 'SSH_TTY', 'TMUX', 'STY']) delete env[key];
let entry = '', host:KittyHost|undefined;
const herdrName = `ab-platform-${process.pid}-${Date.now()}`;
let socket='',pane='';
const events:{ check:string; status:string }[] = [];
async function invoke(args:string[]) {
  const {stdout} = await exec(process.execPath, [entry, ...args], { env, timeout:45_000, maxBuffer:8*1024*1024 });
  return JSON.parse(stdout);
}
async function command(args:string[], name='work') {
  const reply = await invoke(['--session', name, '--json', ...args]);
  assert.equal(reply.ok, true); return reply.result;
}
async function step(check:string, fn:()=>Promise<void>) {
  console.log(check);
  try { await fn(); events.push({check,status:'PASS'}); }
  catch (error) { events.push({check,status:'FAIL'}); throw error; }
}
try {
  await step('Bootstrap an isolated installed CLI from the checkout', async()=>{
    const result = await exec(process.execPath, [resolve('skills/archbrowse/scripts/bootstrap.mjs'), 'install', '--source', process.cwd(), '--upgrade'], {env, timeout:240_000, maxBuffer:8*1024*1024});
    entry = JSON.parse(result.stdout).command[1];
    assert.ok(entry.startsWith(root), 'Use the isolated installed CLI, never a global one');
    const help = (await exec(process.execPath, [entry, '--help'], {env})).stdout;
    assert.ok(help.includes('--headless') && help.includes('--view'));
    const skill = (await exec(process.execPath, [entry, '--skill'], {env})).stdout;
    assert.match(skill, /First use: install/);
    const launcher = join(root, 'bin', process.platform==='win32'?'archbrowse.cmd':'archbrowse');
    const launched = process.platform==='win32'
      ? await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `& '${launcher.replaceAll("'","''")}' --help; exit $LASTEXITCODE`], {env})
      : await exec(launcher, ['--help'], {env});
    assert.match(launched.stdout, /^archbrowse —/);
  });
  const fixture = join(root, 'a local page.html');
  await writeFile(fixture, `<!doctype html><title>Native platform proof</title><style>body{margin:28px;background:#101516;color:#e9eee7;font:20px Arial}button,input{font:inherit;padding:12px;margin:16px;background:#d7ff89;color:#101516;border:0}h1{font-size:32px}</style><h1>ArchBrowse platform proof</h1><button id="counter">Count: 0</button><input id="name" aria-label="Your name"><output id="greeting"></output><script>window.marker=crypto.randomUUID();let n=0;document.querySelector('#counter').onclick=()=>{document.querySelector('#counter').textContent='Count: '+(++n);localStorage.setItem('count',n)};document.querySelector('#name').oninput=e=>document.querySelector('#greeting').textContent='Hello, '+e.target.value;</script>`);
  await step('Start detached browser; click and enter Unicode through the installed CLI', async()=>{
    const start = await invoke([fixture, '--headless','--session','work','--no-install']);
    assert.equal(start.ok,true); assert.equal(start.result.viewerAttached,false);
    const snapshot = await command(['snapshot','-i']);
    await command(['click',snapshot.refs.find((r:{name:string})=>r.name==='Count: 0').ref]);
    await command(['wait','--text','Count: 1']);
    await command(['fill','#name','Calvin 🌙']);
    await command(['wait','--text','Hello, Calvin 🌙']);
    await command(['screenshot',join(artifacts,'01-browser.png')]);
  });
  const marker = await command(['eval','window.marker']);
  if (!herdr) {
    await step('Persist storage across stop/restart without preserving live JavaScript', async()=>{
      await invoke(['sessions','stop','work']);
      await invoke(['--headless','--session','work','--no-install']);
      assert.notEqual(await command(['eval','window.marker']),marker);
      assert.equal(await command(['eval',"localStorage.getItem('count')"]),'1');
    });
    await step('Render a React entry from the installed package', async()=>{
      const target = join(root,'install','node_modules','@archastro','archbrowse','examples','App.tsx');
      await invoke([target,'--headless','--session','react','--no-install']);
      await command(['wait','#counter'],'react');
      await command(['click','#counter'],'react');
      await command(['wait','--text','1 launches'],'react');
      await command(['screenshot',join(artifacts,'02-react.png')],'react');
    });
  } else {
    if(process.platform==='win32') await step('Verify Kitty protocol passthrough in bundled ConPTY',async()=>{
      const packet='\x1b_Ga=q,i=31,s=1,v=1,f=24;AAAA\x1b\\';
      const results=[];
      for(const useConptyDll of [false,true]) {
        let output='',ended=false;
        const pty=spawnPty(process.execPath,['-e',`process.stdout.write(${JSON.stringify(packet)});setTimeout(()=>{},500)`],{env,cwd:process.cwd(),cols:80,rows:24,useConptyDll});
        pty.onData(data=>output+=data);pty.onExit(()=>ended=true);
        try { await waitFor(()=>ended,'ConPTY protocol probe exits',10_000); }
        finally { if(!ended)pty.kill(); }
        results.push({runtime:useConptyDll?'bundled':'system',preserved:output.includes(packet)});
      }
      await writeFile(join(artifacts,'conpty-probe.json'),JSON.stringify(results,null,2));
      assert.equal(results[1].preserved,true,'The tested terminal transport must preserve Kitty APC bytes');
    });
    const config = join(root,'herdr.toml');
    await writeFile(config,'onboarding = false\n[terminal]\nkitty_graphics = true\n[experimental]\nkitty_graphics = true\n');
    Object.assign(env,{HERDR_CONFIG_PATH:config,TERM:'xterm-ghostty',TERM_PROGRAM:'ghostty'});
    await step('Start real HerdR in native PTY/ConPTY and discover its pane', async()=>{
      host = new KittyHost(herdrName,env); host.releaseDimensions();
      await waitFor(async()=>{
        const list=JSON.parse((await exec('herdr',['session','list','--json'],{env,timeout:10_000})).stdout);
        socket=list.sessions.find((s:{name:string;running:boolean})=>s.name===herdrName&&s.running)?.socket_path??'';
        return !!socket;
      },'HerdR endpoint',30_000);
      await waitFor(async()=>{pane=(await rpc(socket,'session.snapshot',{})).snapshot.panes[0]?.pane_id??'';return !!pane;},'HerdR pane',30_000);
    });
    // Use a script file to avoid shell-quoting differences in Windows pane commands.
    const launchScript=join(root,'attach.cjs');
    await writeFile(launchScript,`
      const fs=require('node:fs');
      const path=${JSON.stringify(join(artifacts,'viewer-launch.json'))};
      const info={node:process.execPath,stdinTTY:!!process.stdin.isTTY,stdoutTTY:!!process.stdout.isTTY,
        sessionRoot:process.env.ARCHBROWSE_SESSIONS_DIR,socket:process.env.HERDR_SOCKET_PATH,pane:process.env.HERDR_PANE_ID};
      fs.writeFileSync(path,JSON.stringify(info,null,2));
      const result=require('node:child_process').spawnSync(${JSON.stringify(process.execPath)},${JSON.stringify([entry,'attach','work','--view'])},{stdio:'inherit',env:process.env});
      fs.writeFileSync(path,JSON.stringify({...info,status:result.status,signal:result.signal,error:result.error?.message},null,2));
      process.exit(result.status??1);
    `);
    const quote=(value:string)=>process.platform==='win32'?`'${value.replaceAll("'","''")}'`:"'"+value.replaceAll("'","'\\''")+"'";
    const launch=process.platform==='win32'?`node "${launchScript}"`:[process.execPath,launchScript].map(quote).join(' ');
    for (let attempt=0;attempt<2;attempt++) {
      await step(`HerdR attach ${attempt+1}: exact pixels, human click, agent text, detach`,async()=>{
        await exec('herdr',['pane','run',pane,launch],{env:{...env,HERDR_SOCKET_PATH:socket},timeout:10_000});
        const screenshot=join(artifacts,`herdr-${attempt+1}-browser.png`);
        await waitFor(async()=>{
          if(!host!.frame)return false;
          await command(['screenshot',screenshot]);
          return samePixels(host!.frame,await readFile(screenshot));
        },'HerdR outer frame matches actual browser pixels',30_000);
        await writeFile(join(artifacts,`herdr-${attempt+1}-terminal.png`),host!.frame!);
        assert.equal(await command(['eval','window.marker']),marker);
        const point=await command(['eval',`(()=>{const r=document.querySelector('#counter').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`]);
        host!.click(point.x,point.y);
        await command(['wait','--text',`Count: ${attempt+2}`]);
        await command(['fill','#name',`HerdR ${process.platform} ${attempt+1}`]);
        await command(['wait','--text',`Hello, HerdR ${process.platform} ${attempt+1}`]);
        await rpc(socket,'pane.send_keys',{pane_id:pane,keys:['ctrl+q']});
        await waitFor(async()=>!(await command(['attach'])).viewerAttached,'viewer detached');
        assert.equal(await command(['eval','window.marker']),marker);
      });
    }
  }
  console.log(`PASS: ${artifacts}`);
} catch(error) {
  await writeFile(join(artifacts,'failure.txt'),String((error as Error).stack??error));
  throw error;
} finally {
  if(host&&socket&&pane) {
      const diagnostics={
        viewer:await command(['attach']).catch(error=>({error:String(error)})),
        graphics:await rpc(socket,'pane.graphics.info',{pane_id:pane}).catch(error=>({error:String(error)})),
        pane:await exec('herdr',['pane','read',pane,'--source','recent-unwrapped','--lines','50'],{env:{...env,HERDR_SOCKET_PATH:socket},timeout:10_000}).then(r=>r.stdout).catch(error=>({error:String(error)})),
      };
      await writeFile(join(artifacts,'herdr-diagnostics.json'),JSON.stringify(diagnostics,null,2));
  }
  for (const name of ['work','react']) if(entry) await invoke(['sessions','stop',name]).catch(()=>{});
  if(host) {
    await writeFile(join(artifacts,'herdr-outer.log'),host.output);
    await exec('herdr',['session','stop',herdrName,'--json'],{env,timeout:10_000}).catch(()=>{});
    host.pty.kill();
    await exec('herdr',['session','delete',herdrName,'--json'],{env,timeout:10_000}).catch(()=>{});
  }
  await writeFile(join(artifacts,'report.json'),JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,mode:herdr?'herdr':'cli',events},null,2));
  await rm(root,{recursive:true,force:true,maxRetries:5});
}
process.send?.({type:'platform-complete'});
