import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Geometry } from './kitty.js';

export class HerdrCapabilityError extends Error {
  constructor(public readonly code:string,message:string){super(message);this.name='HerdrCapabilityError';}
}
type Reply={error?:{code:string;message:string};result?:{type?:string;cell_width_px?:number;cell_height_px?:number;pixel_mouse?:boolean;status?:string;diagnostics?:unknown[]}};
function address(env:NodeJS.ProcessEnv) {
  if(env.HERDR_ENV!=='1') return;
  if(!env.HERDR_SOCKET_PATH || !env.HERDR_PANE_ID) throw new Error('HerdR pane context is incomplete. Run from a live HerdR pane, or launch directly in Ghostty.');
  return {socket:env.HERDR_SOCKET_PATH,pane:env.HERDR_PANE_ID};
}
function failure(reply:Reply) {
  if(reply.error?.code==='feature_disabled') return new HerdrCapabilityError('feature_disabled',
    'HerdR image rendering is disabled. Add this to its config.toml:\n\n[experimental]\nkitty_graphics = true\n\n'+
    'Run herdr server reload-config, then detach and reattach the HerdR client before retrying. --force cannot enable rendering.');
  if(reply.error?.code==='cell_size_unavailable') return new HerdrCapabilityError('cell_size_unavailable','HerdR did not report host pixel dimensions after capability discovery. HerdR 0.8.2 clients started with graphics disabled cannot hot-reload that setting. Reattach that client once; no server restart is needed.');
  if(reply.error) return new Error(`HerdR graphics unavailable (${reply.error.code}): ${reply.error.message}`);
}
async function request(socket:string,method:string,params:Record<string,unknown>,keep=false):Promise<{reply:Reply;client:Socket}> {
  return new Promise((resolve,reject)=> {
    const client=createConnection(socket);let text='';
    const error=(e:Error)=>{client.removeAllListeners();client.destroy();reject(e);};
    client.on('connect',()=>client.write(JSON.stringify({id:'react-kitty:graphics',method,params})+'\n'));
    client.on('data',chunk=>{
      text+=chunk.toString();
      if(text.length>1024*1024) {error(new Error('HerdR capability response is too large.'));return;}
      const end=text.indexOf('\n');if(end<0)return;
      try {const reply:Reply=JSON.parse(text.slice(0,end));client.removeAllListeners();client.setTimeout(0);if(!keep)client.destroy();resolve({reply,client});}
      catch {error(new Error('Invalid HerdR graphics response.'));}
    });
    client.on('error',error);client.on('end',()=>error(new Error('HerdR closed the graphics request.')));
    client.setTimeout(2500,()=>error(new Error('HerdR graphics request timed out.')));
  });
}
export async function reloadHerdrConfig(env:NodeJS.ProcessEnv=process.env) {
  const target=address(env);if(!target)throw new Error('Reload HerdR from a live HerdR pane.');
  const {reply}=await request(target.socket,'server.reload_config',{});
  const error=failure(reply);if(error)throw error;
  if(reply.result?.status!=='applied')throw new Error('HerdR did not apply the config reload. The updated file and backup were retained.');
}
interface DiscoveryOptions {timeoutMs?:number;retryMs?:number;signal?:AbortSignal;onWaiting?:()=>void}
async function discover(socket:string,pane:string,options:DiscoveryOptions={}):Promise<Reply> {
  const deadline=Date.now()+(options.timeoutMs??5000);let waiting=false;
  while(true) {
    options.signal?.throwIfAborted();
    const {reply}=await request(socket,'pane.graphics.info',{pane_id:pane});
    if(reply.error?.code==='cell_size_unavailable' && Date.now()<deadline) {
      if(!waiting){waiting=true;options.onWaiting?.();}
      await delay(Math.min(options.retryMs??100,Math.max(1,deadline-Date.now())),undefined,{signal:options.signal});
      continue;
    }
    const error=failure(reply);if(error)throw error;
    if(!reply.result?.cell_width_px || !reply.result?.cell_height_px)throw new Error('HerdR returned no pixel dimensions for this pane.');
    return reply;
  }
}
export async function checkHerdrGraphics(env:NodeJS.ProcessEnv=process.env,options:DiscoveryOptions={}):Promise<void> {
  const target=address(env);if(!target)return;
  await discover(target.socket,target.pane,options);
}
export class HerdrGraphics {
  pixelMouse=false;
  private closed=false;
  private abort=new AbortController();
  private pendingError:Error|undefined;
  private constructor(private socket:string,private pane:string,private client:Socket,private failed:(error:Error)=>void) {
    let text='';
    const fail=(error:Error)=>{if(!this.closed){this.pendingError=error;this.abort.abort();this.failed(error);}};
    client.on('error',fail);
    client.on('close',()=>fail(new Error('HerdR graphics stream disconnected.')));
    client.on('data',chunk=>{
      text+=chunk.toString();
      if(text.length>1024*1024) {fail(new Error('HerdR graphics response is too large.'));client.destroy();return;}
      let end:number;
      while((end=text.indexOf('\n'))>=0){const line=text.slice(0,end);text=text.slice(end+1);try{const error=failure(JSON.parse(line));if(error)fail(error);}catch{fail(new Error('Invalid HerdR graphics stream response.'));}}
    });
  }
  static async open(failed:(error:Error)=>void,env:NodeJS.ProcessEnv=process.env,options:DiscoveryOptions={}):Promise<HerdrGraphics|undefined> {
    const target=address(env);if(!target)return;
    await checkHerdrGraphics(env,options);
    const {reply,client}=await request(target.socket,'pane.graphics.stream',{pane_id:target.pane,layer_id:'react-kitty'},true);
    const error=failure(reply);if(error){client.destroy();throw error;}
    return new HerdrGraphics(target.socket,target.pane,client,failed);
  }
  async geometry(current:Geometry):Promise<Geometry> {
    const reply=await discover(this.socket,this.pane,{signal:this.abort.signal});
    this.pixelMouse=reply.result?.pixel_mouse===true;
    const width=reply.result?.cell_width_px,height=reply.result?.cell_height_px;
    if(!width || !height)throw new Error('HerdR returned no pixel dimensions for this pane.');
    return {...current,cellWidth:width,cellHeight:height};
  }
  async frame(png:Buffer,columns:number,rows:number) {
    if(this.pendingError)throw this.pendingError;
    if(png.length>32*1024*1024-4096)throw new Error('Frame exceeds the HerdR transport limit. Reduce the viewport.');
    const header={format:'png',image_width:png.readUInt32BE(16),image_height:png.readUInt32BE(20),data_length:png.length,placement:{viewport_col:0,viewport_row:0,grid_cols:columns,grid_rows:rows}};
    if(!this.client.write(Buffer.concat([Buffer.from(JSON.stringify(header)+'\n'),png])))await once(this.client,'drain',{signal:this.abort.signal});
  }
  close(){this.closed=true;this.abort.abort();this.client.destroy();}
}
