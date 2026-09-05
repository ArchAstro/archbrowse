import { createServer, createConnection, type Socket } from 'node:net';
import { chmod, rm, mkdir, lstat, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sessionsRoot } from '../sessions.js';
import { agentSocket, AgentError, MAX_MESSAGE, validateRequest, type AgentRequest, type AgentReply } from './protocol.js';

/** One request per connection. The session directory and socket are owner-only. */
export async function serveAgent(name:string,handle:(request:AgentRequest)=>Promise<unknown>) {
  const path=agentSocket(name),clients=new Set<Socket>();
  // Caller holds the named-session lock, so this can only be a stale endpoint.
  if(process.platform!=='win32'){
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const info=await lstat(dirname(path));
    if(info.isSymbolicLink() || (process.getuid && info.uid!==process.getuid()))throw new AgentError('unsafe_socket_directory','Agent socket directory is not owned by the current user.');
    await chmod(dirname(path),0o700);await rm(path,{force:true});
  }
  const server=createServer(client=> {
    clients.add(client);client.on('close',()=>clients.delete(client));client.on('error',()=>{});
    let buffer=Buffer.alloc(0),accepted=false;
    function reply(value:AgentReply) {
      let output=JSON.stringify(value)+'\n';
      if(Buffer.byteLength(output)>MAX_MESSAGE)output=JSON.stringify({ok:false,error:{code:'response_too_large',message:'Result exceeds the 32 MiB response limit.'}})+'\n';
      if(!client.destroyed)client.end(output);
    }
    client.setTimeout(35000,()=>client.destroy());
    client.on('data',chunk=> {
      if(accepted)return;
      buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>1024*1024){accepted=true;reply({ok:false,error:{code:'request_too_large',message:'Request exceeds 1 MiB.'}});return;}
      const end=buffer.indexOf(10);if(end<0)return;accepted=true;
      void (async()=> {
        try {const request=validateRequest(JSON.parse(buffer.subarray(0,end).toString()));const result=await handle(request);reply({ok:true,result});}
        catch(error) {reply({ok:false,error:{code:error instanceof AgentError?error.code:'command_failed',message:error instanceof Error?error.message:String(error)}});}
      })();
    });
  });
  try {
    await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(path,yes);});
    if(process.platform!=='win32')await chmod(path,0o600);
  }catch(error){server.close();throw error;}
  return {async close(){for(const client of clients)client.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));if(process.platform!=='win32'){await rm(path,{force:true});if(dirname(path)!==join(sessionsRoot(),name))await rmdir(dirname(path)).catch(()=>{});}}};
}
export async function sendAgent(name:string,request:AgentRequest):Promise<unknown> {
  return new Promise((resolve,reject)=> {
    const client=createConnection(agentSocket(name));let buffer=Buffer.alloc(0),finished=false;
    const fail=(error:Error)=>{if(finished)return;finished=true;client.destroy();reject(error);};
    client.on('connect',()=>client.write(JSON.stringify(request)+'\n'));
    client.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length>MAX_MESSAGE){fail(new AgentError('response_too_large','Agent response exceeds 32 MiB.'));return;}
      const end=buffer.indexOf(10);if(end<0)return;
      let response:AgentReply;try{response=JSON.parse(buffer.subarray(0,end).toString());}catch{fail(new AgentError('protocol_error','Invalid session response.'));return;}
      if(!response.ok){fail(new AgentError(response.error?.code??'command_failed',response.error?.message??'Session command failed.'));return;}
      finished=true;client.destroy();resolve(response.result);
    });
    client.on('error',(error:NodeJS.ErrnoException)=>fail(['ENOENT','ECONNREFUSED'].includes(error.code??'')?new AgentError('session_not_running',`Session "${name}" has no live agent endpoint. Start it with react-kitty --session ${name}; restart an older viewer to enable agent control.`):error));
    client.on('close',()=>{if(!finished)fail(new AgentError('session_closed','The session closed before the command completed.'));});
    client.setTimeout((request.timeout??10000)+15000,()=>fail(new AgentError('command_timeout','Session command timed out.')));
  });
}
