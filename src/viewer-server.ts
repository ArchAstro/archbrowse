import { createServer, type Socket } from 'node:net';
import { chmod, mkdir, lstat, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { InputParser, type Input } from './input.js';
import { validateGeometry, viewerSocket, type ViewerGeometry } from './viewer-protocol.js';

interface ViewerHost {
  configure:(value:ViewerGeometry)=>Promise<void>;
  input:(event:Input)=>Promise<unknown>;
  frame:()=>Buffer|undefined;
  mobile?:{width:number;height:number};
}
/** One visual controller; agents continue using the independent command socket. */
export async function serveViewer(name:string,host:ViewerHost,fps:number) {
  const path=viewerSocket(name),clients=new Set<Socket>();let active:Socket|undefined,closing=false;
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(process.platform!=='win32') {
    const info=await lstat(dirname(path));
    if(info.isSymbolicLink() || (process.getuid && info.uid!==process.getuid()))throw new Error('Unsafe viewer socket directory.');
    await chmod(dirname(path),0o700);await rm(path,{force:true});
  }
  const server=createServer(client=>{
    clients.add(client);client.on('error',()=>{});
    let buffer='',ready=false,last:Buffer|undefined,pending=0,queue:Promise<unknown>=Promise.resolve();
    let escapeTimer:ReturnType<typeof setTimeout>|undefined;
    const fail=(error:unknown,code='viewer_error')=>{if(!client.destroyed)client.end(JSON.stringify({type:'error',code,message:String(error instanceof Error?error.message:error)})+'\n');};
    const enqueue=(fn:()=>Promise<unknown>)=>{
      if(++pending>256){client.destroy();return;}
      queue=queue.then(()=>client.destroyed?undefined:fn()).catch(error=>{fail(error);client.destroy();}).finally(()=>{pending--;});
    };
    const parser=new InputParser(event=>{
      if(['graphics','mode','size'].includes(event.type))return;
      if(event.type==='key'&&event.key.toLowerCase()==='q'&&event.modifiers.includes('Control'))return;
      enqueue(()=>host.input(event));
    });
    client.setTimeout(5000,()=>client.destroy());
    client.on('data',chunk=>{
      buffer+=chunk.toString();
      if(Buffer.byteLength(buffer)>1024*1024){client.destroy();return;}
      let end:number;
      while((end=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try {
          const message=JSON.parse(line);
          if(!ready) {
            if(message.type!=='attach')throw new Error('First viewer message must attach.');
            const config=validateGeometry(message);
            if(active){fail(new Error('Another terminal viewer is already attached.'),'viewer_busy');return;}
            active=client;ready=true;client.setTimeout(0);
            enqueue(async()=>{await host.configure(config);client.write(JSON.stringify({type:'ready',mobile:host.mobile})+'\n');});
          }else if(message.type==='resize') {
            const config=validateGeometry(message);enqueue(async()=>{await host.configure(config);last=undefined;});
          }else if(message.type==='input'&&typeof message.data==='string'&&message.data.length<=131072) {
            parser.push(Buffer.from(message.data,'base64'));clearTimeout(escapeTimer);escapeTimer=setTimeout(()=>parser.flushEscape(),35);
          }else throw new Error('Invalid viewer message.');
        }catch(error){fail(error);return;}
      }
    });
    const timer=setInterval(()=>{
      if(!ready||active!==client||pending||client.destroyed||client.writableLength)return;
      const frame=host.frame();if(!frame || frame===last || frame.equals(last??Buffer.alloc(0)))return;
      if(frame.length>20*1024*1024){fail(new Error('Viewer frame exceeds 20 MiB.'));return;}
      last=frame;client.write(JSON.stringify({type:'frame',image:frame.toString('base64')})+'\n');
    },1000/fps);
    client.on('close',()=>{
      clearInterval(timer);clearTimeout(escapeTimer);clients.delete(client);
      if(active===client) {
        // Release held modifiers before allowing a replacement viewer to attach.
        void queue.then(()=>closing?undefined:host.input({type:'focus',focused:false})).catch(()=>{}).finally(()=>{if(active===client)active=undefined;});
      }
    });
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
  if(process.platform!=='win32')await chmod(path,0o600);
  return {get attached(){return !!active;},async close(){closing=true;for(const c of clients)c.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));if(process.platform!=='win32')await rm(path,{force:true});}};
}
