import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { InputParser } from './input.js';
import { HerdrGraphics } from './herdr.js';
import { offerHerdrSetup } from './herdr-setup.js';
import { encodeFrame, enterTerminal, leaveTerminal, geometryQuery, graphicsQuery, displayGeometry, type Geometry } from './kitty.js';
import { sendAgent } from './agent/ipc.js';
import { AgentError, MAX_MESSAGE } from './agent/protocol.js';
import { viewerSocket } from './viewer-protocol.js';
import type { SessionOptions } from './session.js';

/** A terminal transport only: disconnecting never owns or closes Chromium. */
export async function attachViewer(name:string,options:Pick<SessionOptions,'fps'|'cellWidth'|'cellHeight'|'force'>) {
  const stdin=process.stdin,stdout=process.stdout;
  if(!stdin.isTTY||!stdout.isTTY)throw new Error('--view requires a TTY and a Kitty graphics terminal.');
  if(process.env.TMUX&&!options.force)throw new Error('tmux rendering is not supported. Attach in a Kitty graphics terminal.');
  const info=await sendAgent(name,{command:'attach',args:[]}) as {mode?:string};
  if(info.mode!=='background')throw new AgentError('viewer_unavailable','This session owns its original terminal. Start it with --headless to attach detachable viewers.');
  let geometry:Geometry={columns:stdout.columns||80,rows:stdout.rows||24,cellWidth:options.cellWidth,cellHeight:options.cellHeight};
  let pixel=false,graphics:boolean|undefined,revision=0,applied=-1,entered=false,stopped=false,ready=false;
  let socket:Socket|undefined,herdr:HerdrGraphics|undefined,mobile:{width:number;height:number}|undefined;
  let frame:Buffer|undefined,last:Buffer|undefined,buffer='',failure:unknown;
  const pendingInputs:Buffer[]=[];let pendingBytes=0;
  let escapeTimer:ReturnType<typeof setTimeout>|undefined;
  const abort=new AbortController(),stop=()=>{stopped=true;abort.abort();};
  const fail=(error:unknown)=>{failure=error;stop();};
  const send=(value:unknown)=>{
    if(!socket||socket.destroyed)return;
    if(socket.writableLength>1024*1024){fail(new Error('Viewer input queue exceeded 1 MiB.'));return;}
    socket.write(JSON.stringify(value)+'\n');
  };
  const parser=new InputParser(event=>{
    if(event.type==='graphics')graphics=event.ok;
    else if(event.type==='mode'&&event.mode===1016&&(event.status===1||event.status===2)){pixel=true;revision++;stdout.write('\x1b[?1016h');}
    else if(event.type==='size'&&event.width>0&&event.height>0){
      geometry=event.kind===6?{...geometry,cellWidth:event.width,cellHeight:event.height}:{...geometry,cellWidth:event.width/geometry.columns,cellHeight:event.height/geometry.rows};revision++;
    }else if(event.type==='key'&&event.key.toLowerCase()==='q'&&event.modifiers.includes('Control'))stop();
  });
  const onData=(bytes:Buffer)=>{
    parser.push(bytes);clearTimeout(escapeTimer);escapeTimer=setTimeout(()=>parser.flushEscape(),35);
    if(ready&&!stopped){
      if(revision===applied)send({type:'input',data:bytes.toString('base64')});
      else {pendingInputs.push(bytes);pendingBytes+=bytes.length;if(pendingBytes>1024*1024)fail(new Error('Viewer input queue exceeded 1 MiB.'));}
    }
  };
  const onResize=()=>{geometry={...geometry,columns:stdout.columns,rows:stdout.rows};revision++;if(!herdr&&entered)stdout.write(geometryQuery);};
  async function write(value:string){if(!stdout.write(value))try{await once(stdout,'drain',{signal:abort.signal});}catch(error){if(!stopped)throw error;}}
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);stdout.on('resize',onResize);
  try {
    const open=()=>HerdrGraphics.open(fail,process.env,{signal:abort.signal,onWaiting:()=>process.stderr.write('Waiting for HerdR to discover host pixel dimensions…\n')});
    try{herdr=await open();}catch(error){await offerHerdrSetup(error,{signal:abort.signal});herdr=await open();}
    if(herdr){geometry=await herdr.geometry(geometry);pixel=herdr.pixelMouse;}
    stdin.setRawMode(true);stdin.resume();stdin.on('data',onData);entered=true;
    await write(enterTerminal+(herdr?(pixel?'\x1b[?1016h':''):graphicsQuery+geometryQuery));
    for(let i=0;i<20&&!herdr&&graphics===undefined&&!stopped;i++)await delay(25);
    if(!herdr&&graphics!==true&&!options.force)throw new Error('Terminal did not confirm Kitty graphics support.');
    if(stopped)return;
    socket=createConnection(viewerSocket(name));
    socket.on('error',fail);socket.on('close',stop);
    socket.on('data',chunk=>{
      buffer+=chunk.toString();if(Buffer.byteLength(buffer)>MAX_MESSAGE){fail(new Error('Viewer frame exceeds transport limit.'));return;}
      let end:number;
      while((end=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try {
          const message=JSON.parse(line);
          if(message.type==='error')fail(new AgentError(message.code,message.message));
          else if(message.type==='ready'){ready=true;mobile=message.mobile;}
          else if(message.type==='frame')frame=Buffer.from(message.image,'base64');
          else throw new Error('Invalid viewer response.');
        }catch(error){fail(error);}
      }
    });
    socket.on('connect',()=>send({type:'attach',geometry,pixel}));
    const deadline=Date.now()+15000;
    while(!ready&&!stopped){if(Date.now()>deadline)throw new Error('Viewer attachment timed out.');await delay(20);}
    let id:101|102=101;
    while(!stopped) {
      if(applied!==revision) {
        applied=revision;
        if(herdr){geometry=await herdr.geometry(geometry);const next=herdr.pixelMouse;if(pixel!==next){pixel=next;await write(pixel?'\x1b[?1016h':'\x1b[?1016l');}}
        send({type:'resize',geometry,pixel});last=undefined;
      }
      for(const bytes of pendingInputs.splice(0))send({type:'input',data:bytes.toString('base64')});pendingBytes=0;
      const png=frame;
      if(png&&(!last||!png.equals(last))) {
        const placement=displayGeometry(geometry,mobile);
        if(herdr)await herdr.frame(png,placement.columns,placement.rows);else await write(encodeFrame(png,placement.columns,placement.rows,id));
        last=png;id=id===101?102:101;
      }
      await delay(1000/options.fps);
    }
    if(failure)throw failure;
  }finally {
    stop();socket?.destroy();herdr?.close();clearTimeout(escapeTimer);
    stdin.off('data',onData);stdout.off('resize',onResize);process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('SIGHUP',stop);
    if(entered){stdout.write(leaveTerminal);stdin.setRawMode(false);stdin.pause();}
  }
}
