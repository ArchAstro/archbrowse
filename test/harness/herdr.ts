import assert from 'node:assert/strict';
import { spawn, type IPty } from 'node-pty';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import type { Browser, Page, Route } from 'playwright-core';
import { PNG } from 'pngjs';
import { waitFor, samePixels } from './terminal.js';
const exec=promisify(execFile);

/** Outer terminal receiver. The process under test is HerdR itself, not a fake multiplexer. */
export class KittyHost {
  pty:IPty; output=''; cols=120;rows=45; private pending='';private payload='';private imageId='';
  cellWidth=8;cellHeight=16;pixelMouse=false;private pixelTty?:string;
  private row=0;private col=0;private dimensionQueries:string[]=[];
  dimensionsReady=false;
  releaseDimensions(){this.dimensionsReady=true;for(const query of this.dimensionQueries)this.replyDimensions(query);this.dimensionQueries=[];}
  private replyDimensions(query:string){if(query==='\x1b[16t')this.pty.write(`\x1b[6;${this.cellHeight};${this.cellWidth}t`);else this.pty.write(`\x1b[4;${this.rows*this.cellHeight};${this.cols*this.cellWidth}t`);}
  images=new Map<string,Buffer>();
  placement:{id:string;columns:number;rows:number;row:number;col:number}|undefined;
  constructor(name:string,env:NodeJS.ProcessEnv,pixelTty?:string) {
    this.pixelTty=pixelTty;
    if(pixelTty){this.cols=106;this.rows=35;this.cellWidth=21;this.cellHeight=48;}
    const file=pixelTty?'python3':'herdr';
    const args=pixelTty?[resolve('test/harness/pixel-pty.py'),'launch',pixelTty,String(this.cols),String(this.rows),String(this.cellWidth),String(this.cellHeight),'herdr','--session',name]:['--session',name];
    this.pty=spawn(file,args,{cwd:process.cwd(),env,cols:this.cols,rows:this.rows});
    this.pty.onData(data=>{this.output+=data;this.pending+=data;this.parse();});
  }
  private parse(){
    while(this.pending){
      const start=this.pending.indexOf('\x1b');if(start<0){this.pending='';return;}this.pending=this.pending.slice(start);
      if(this.pending.startsWith('\x1b_G')){
        const end=this.pending.indexOf('\x1b\\');if(end<0)return;
        const packet=this.pending.slice(3,end),split=packet.indexOf(';');
        const header=split<0?packet:packet.slice(0,split),payload=split<0?'':packet.slice(split+1);
        const p=Object.fromEntries(header.split(',').map(field=>field.split('=')));
        if(p.a==='t'||p.a==='T'){this.imageId=p.i;this.payload='';assert.equal(p.f,'100','HerdR inline PNG transport');}
        if(p.a==='t'||p.a==='T'||p.m!==undefined){this.payload+=payload;if(p.m!=='1'){const png=Buffer.from(this.payload,'base64');PNG.sync.read(png);this.images.set(this.imageId,png);}}
        if(p.a==='p'||(p.a==='T'&&p.p))this.placement={id:p.i,columns:Number(p.c),rows:Number(p.r),row:this.row,col:this.col};
        if(p.a==='d'&&p.d==='I')this.images.delete(p.i);
        if(p.q!=='2')this.pty.write(`\x1b_Gi=${p.i??0}${p.p?',p='+p.p:''};OK\x1b\\`);
        this.pending=this.pending.slice(end+2);continue;
      }
      if(this.pending.startsWith('\x1b]')||this.pending.startsWith('\x1bP')){
        let end=this.pending.indexOf('\x1b\\'),length=2;const bell=this.pending.indexOf('\x07');if(bell>=0&&(end<0||bell<end)){end=bell;length=1;}if(end<0)return;
        const message=this.pending.slice(0,end);
        if(message.startsWith('\x1b]10;?'))this.pty.write('\x1b]10;rgb:eeee/eeee/eeee\x1b\\');
        if(message.startsWith('\x1b]11;?'))this.pty.write('\x1b]11;rgb:1010/1515/1616\x1b\\');
        this.pending=this.pending.slice(end+length);continue;
      }
      const csi=/^\x1b\[([0-?]*)([ -/]*)([@-~])/.exec(this.pending);
      if(csi){const cmd=csi[0];
        if(cmd==='\x1b[?1016h')this.pixelMouse=true;
        if(cmd==='\x1b[?1016l')this.pixelMouse=false;
        if(csi[3]==='H'||csi[3]==='f'){const [row,col]=csi[1].split(';').map(Number);this.row=(row||1)-1;this.col=(col||1)-1;}
        if(cmd==='\x1b[16t'||cmd==='\x1b[14t'){if(this.dimensionsReady)this.replyDimensions(cmd);else this.dimensionQueries.push(cmd);}
        if(cmd==='\x1b[c'||cmd==='\x1b[0c')this.pty.write('\x1b[?62;4;22c');
        if(cmd==='\x1b[>c'||cmd==='\x1b[>0c')this.pty.write('\x1b[>1;4000;0c');
        if(cmd==='\x1b[?u')this.pty.write('\x1b[?0u');
        if(cmd.endsWith('$p'))this.pty.write(`\x1b[${csi[1]};2$y`);
        if(cmd==='\x1b[6n')this.pty.write('\x1b[1;1R');
        this.pending=this.pending.slice(cmd.length);continue;
      }
      if(this.pending.length<3||this.pending.startsWith('\x1b['))return;this.pending=this.pending.slice(2);
    }
  }
  get frame(){return this.placement?this.images.get(this.placement.id):undefined;}
  click(x:number,y:number){assert.ok(this.placement);const col=this.pixelMouse?Math.round(this.placement.col*this.cellWidth+x)+1:this.placement.col+Math.floor(x/this.cellWidth)+1,row=this.pixelMouse?Math.round(this.placement.row*this.cellHeight+y)+1:this.placement.row+Math.floor(y/this.cellHeight)+1;this.pty.write(`\x1b[<0;${col};${row}M\x1b[<0;${col};${row}m`);}
  async resize(cols:number,rows:number){this.cols=cols;this.rows=rows;if(this.pixelTty)await exec('python3',[resolve('test/harness/pixel-pty.py'),'resize',this.pixelTty,String(cols),String(rows),String(this.cellWidth),String(this.cellHeight)]);else this.pty.resize(cols,rows);}
}
export async function rpc(socket:string,method:string,params:unknown):Promise<any>{
  return new Promise((resolve,reject)=>{const client=createConnection(socket,()=>client.write(JSON.stringify({id:'herdr-test',method,params})+'\n'));let data='';client.on('data',chunk=>{data+=chunk;const end=data.indexOf('\n');if(end>=0){client.end();const reply=JSON.parse(data.slice(0,end));if(reply.error)reject(new Error(JSON.stringify(reply.error)));else resolve(reply.result);}});client.on('error',reject);client.setTimeout(5000,()=>{client.destroy();reject(new Error('HerdR API timeout'));});});
}
export async function testHerdr(browser:Browser,endpoint:string,artifacts:string,legacy=false,setup?:'accept'|'decline',link:boolean|'live'=false,agent=false){
  const dir=await mkdtemp(join(tmpdir(),'archbrowse-herdr-e2e-'));const name=`archbrowse-test-${process.pid}-${Date.now()}`;
  const config=join(dir,'config.toml');await writeFile(config,`onboarding = false\n[experimental]\nkitty_graphics = ${!legacy&&!setup}\n`);
  const env:NodeJS.ProcessEnv={...process.env,HERDR_ENV:'',HERDR_PANE_ID:'',HERDR_SOCKET_PATH:'',HERDR_SESSION:'',HERDR_CONFIG_PATH:config,ARCHBROWSE_SESSIONS_DIR:join(dir,'react-sessions'),TERM:'xterm-ghostty',TERM_PROGRAM:'ghostty'};
  // This is a local outer terminal, independent of the shell running the tests.
  for(const name of ['SSH_CONNECTION','SSH_TTY','TMUX','STY','HERDR_REMOTE_KEYBINDINGS'])delete env[name];
  const host=new KittyHost(name,env,link?join(dir,'tty'):undefined);let socket='',page:Page|undefined;
  const before=new Set(browser.contexts().flatMap(c=>c.pages()));
  const context=browser.contexts()[0];
  let startupResize=false;
  const duringStartup=async(route:Route)=>{
    if(!startupResize && route.request().isNavigationRequest()) {
      startupResize=true;
      await host.resize(130,48);
      // Deliberately hold navigation open while SIGWINCH is delivered. This
      // reproduces resizing before runSession has finished view.start().
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    await route.continue();
  };
  async function capture(slug:string){
    let reference:Buffer;
    // HerdR can clip the initial full-terminal frame while its sidebar/pane
    // geometry settles. Pixel parity alone can accept that pre-resize frame.
    await waitFor(async()=>{
      reference=await page!.screenshot();
      if(!host.frame||!host.placement||!samePixels(reference,host.frame))return false;
      const decoded=PNG.sync.read(host.frame);
      return host.placement.columns*host.cellWidth===decoded.width && host.placement.rows*host.cellHeight===decoded.height;
    },`HerdR outer pixels and placement ${slug}`);
    assert.ok(host.placement && host.placement.col>=0 && host.placement.row>=0);
    const decoded=PNG.sync.read(host.frame!);
    assert.equal(host.placement.columns*host.cellWidth,decoded.width,'placement matches browser width');
    assert.equal(host.placement.rows*host.cellHeight,decoded.height,'placement matches browser height');
    assert.ok(host.placement.col+host.placement.columns<=host.cols && host.placement.row+host.placement.rows<=host.rows,'frame placement within outer terminal');
    await writeFile(join(artifacts,slug+'-browser.png'),reference!);await writeFile(join(artifacts,slug+'-terminal.png'),host.frame!);
  }
  try{
    if(!legacy&&!setup&&!link&&!agent)await context.route('**/*',duringStartup);
    await waitFor(async()=>{const {stdout}=await exec('herdr',['session','list','--json'],{env});socket=JSON.parse(stdout).sessions.find((s:{name:string;running:boolean})=>s.name===name&&s.running)?.socket_path??'';return !!socket;},'isolated HerdR server');
    let pane='';await waitFor(async()=>{const snapshot=await rpc(socket,'session.snapshot',{});pane=snapshot.snapshot.panes[0]?.pane_id??'';return !!pane;},'HerdR pane');
    if(legacy){await waitFor(()=>host.output.includes('menu'),'HerdR client first paint before config reload');await assert.rejects(()=>rpc(socket,'pane.graphics.info',{pane_id:pane}),/feature_disabled/);host.releaseDimensions();await writeFile(config,'onboarding = false\n[experimental]\nkitty_graphics = true\n');await rpc(socket,'server.reload_config',{});}
    if(setup)await assert.rejects(()=>rpc(socket,'pane.graphics.info',{pane_id:pane}),/feature_disabled/);
    else if(legacy)await assert.rejects(()=>rpc(socket,'pane.graphics.info',{pane_id:pane}),/cell_size_unavailable/);
    const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
    const command=[process.execPath,resolve('dist/cli.js'),link==='live'?'https://example.com/':link?resolve('test/fixtures/example-domain.html'):resolve('examples/html/index.html'),...(agent?['--session','agent-test']:['--cdp',endpoint]),'--no-install'].map(quote).join(' ');
    await exec('herdr',['pane','run',pane,command],{env:{...env,HERDR_SOCKET_PATH:socket}});
    if(agent){
      const control=async(args:string[])=>JSON.parse((await exec(process.execPath,[resolve('dist/cli.js'),'--session','agent-test','--json',...args],{env})).stdout).result;
      try {await waitFor(()=>!!host.frame,'named viewer renders through HerdR');}catch(error){
        const info=await control(['attach']).catch(e=>({error:String(e)}));await writeFile(join(artifacts,'herdr-agent-failure.json'),JSON.stringify(info,null,2));
        await control(['screenshot',join(artifacts,'herdr-agent-failure.png')]).catch(()=>{});
        throw error;
      }
      const attached=await control(['attach']);assert.equal(attached.session,'agent-test');
      const snapshot=await control(['snapshot','-i']);
      const button=snapshot.refs.find((r:{role:string;name:string})=>r.role==='button'&&r.name==='Count: 0');assert.ok(button);
      await control(['click',button.ref]);assert.equal(await control(['get','text','#count']),'1');
      const screenshot=join(artifacts,'29-herdr-agent-browser.png');await control(['screenshot',screenshot]);const reference=await readFile(screenshot);
      await waitFor(()=>!!host.frame&&samePixels(host.frame,reference),'agent changes visible in HerdR outer pixels');
      await writeFile(join(artifacts,'29-herdr-agent-terminal.png'),host.frame!);
      await rpc(socket,'pane.send_keys',{pane_id:pane,keys:['ctrl+q']});await waitFor(()=>!host.frame,'agent viewer clears HerdR on exit');
      await waitFor(async()=>{try{await control(['attach']);return false;}catch(error){const reply=JSON.parse((error as {stdout:string}).stdout);return reply.error?.code==='session_not_running'||reply.error?.code==='session_closed';}},'agent endpoint closes with HerdR viewer');
      return;
    }
    if(setup){
      const text=()=>host.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x1b\x07]*(?:\x07|\x1b\\)/g,'').replace(/\s/g,'');
      await waitFor(()=>text().includes('[y/N]'),'config update offered inside HerdR');
      host.pty.write(setup==='accept'?'y\r':'n\r');
      if(setup==='accept'){
        await waitFor(()=>text().includes('ReloadedHerdRconfig'),'accepted config update reloaded');
        await waitFor(()=>text().includes('runningclientcannothot-reload'),'one-time old-client limitation after update');
        assert.ok((await readFile(config,'utf8')).includes('kitty_graphics = true'));
        assert.equal((await readdir(dir)).filter(file=>file.endsWith('.bak')).length,1);
      }else{
        await waitFor(()=>text().includes('setupwasdeclined'),'declined config update');
        assert.ok((await readFile(config,'utf8')).includes('kitty_graphics = false'));
        assert.equal((await readdir(dir)).filter(file=>file.endsWith('.bak')).length,0);
      }
      return;
    }
    if(legacy){
      // Read the real client output: HerdR's pane.read can report an empty
      // snapshot while the client is visibly painting the command's stderr.
      const text=()=>host.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x1b\x07]*(?:\x07|\x1b\\)/g,'').replace(/\s/g,'');
      await waitFor(()=>text().includes('WaitingforHerdR'),'CLI waits for capability discovery');
      await waitFor(()=>text().includes('cannothot-reload'),'old HerdR client limitation reproduced',10000);
      assert.equal(host.images.size,0);assert.equal(browser.contexts().flatMap(c=>c.pages()).some(p=>!before.has(p)),false);
      return;
    }
    await waitFor(()=>{page=browser.contexts().flatMap(c=>c.pages()).find(p=>!before.has(p));return !!page;},'CLI Chromium page inside HerdR');
    page!.setDefaultTimeout(10000);
    if(link){
      await page!.waitForSelector('a');
      const info=await rpc(socket,'pane.graphics.info',{pane_id:pane});assert.equal(info.pixel_mouse,true,'real HerdR pixel capability from PTY ioctl');
      const box=await page!.locator('a').boundingBox();assert.ok(box);
      const quantizedY=(Math.floor((box.y+box.height/2)/host.cellHeight)+.5)*host.cellHeight;
      assert.ok(quantizedY<box.y || quantizedY>box.y+box.height,'cell-mode would miss the small link');
      await capture(link==='live'?'27-herdr-live-link':'25-herdr-small-link');
      await page!.evaluate(()=>{(window as any).__pointer=[];for(const type of ['mousedown','mouseup','click'])addEventListener(type,event=>{const e=event as MouseEvent;(window as any).__pointer.push({type:e.type,x:e.clientX,y:e.clientY,target:(e.target as Element)?.outerHTML.slice(0,120)});},true);});
      if(link!=='live')await page!.route('https://iana.org/domains/example',route=>route.fulfill({contentType:'text/html',body:'<h1>Example domains destination</h1>'}));
      host.click(box.x+box.width/2,box.y+box.height/2);
      await page!.waitForURL(url=>url.hostname.endsWith('iana.org')&&url.pathname.includes('example'),{waitUntil:'domcontentloaded'});
      await page!.waitForSelector('h1');await capture(link==='live'?'28-herdr-live-iana':'26-herdr-link-navigated');
      await rpc(socket,'pane.send_keys',{pane_id:pane,keys:['ctrl+q']});await waitFor(()=>page!.isClosed(),'link CLI exit');
      return;
    }
    await page!.waitForSelector('#counter');await capture('22-herdr-render');
    assert.ok(startupResize,'pane resized while initial navigation was pending');
    host.releaseDimensions();
    const box=await page!.locator('#counter').boundingBox();assert.ok(box);host.click(box.x+box.width/2,box.y+box.height/2);
    await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1');await capture('23-herdr-click');
    const old=await page!.evaluate(()=>({width:innerWidth,height:innerHeight}));await host.resize(140,50);
    await page!.waitForFunction(old=>innerWidth!==old.width||innerHeight!==old.height,old);await capture('24-herdr-resize');
    await rpc(socket,'pane.send_keys',{pane_id:pane,keys:['ctrl+q']});await waitFor(()=>page!.isClosed(),'CLI exit');
    await waitFor(()=>!host.frame,'CLI exit clears HerdR image layer');
  }finally{
    await context.unroute('**/*',duringStartup);
    if(link&&page&&!page.isClosed())await writeFile(join(artifacts,link==='live'?'herdr-live-link-evidence.json':'herdr-link-evidence.json'),JSON.stringify({pixelMouse:host.pixelMouse,url:page.url(),events:await page.evaluate(()=>(window as any).__pointer).catch(()=>[])},null,2));
    await writeFile(join(artifacts,agent?'herdr-agent-pty.log':link==='live'?'herdr-live-link-pty.log':link?'herdr-link-pty.log':setup?`herdr-setup-${setup}-pty.log`:legacy?'herdr-legacy-client-pty.log':'herdr-delayed-discovery-pty.log'),host.output);
    await exec('herdr',['session','stop',name,'--json'],{env}).catch(()=>{});host.pty.kill();
    await exec('herdr',['session','delete',name,'--json'],{env}).catch(()=>{});
    await rm(dir,{recursive:true,force:true});
  }
}
