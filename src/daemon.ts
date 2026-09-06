import { fork } from 'node:child_process';
import { open, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionsRoot, validateSessionName, listSessions } from './sessions.js';
import { sendAgent } from './agent/ipc.js';
import { AgentError } from './agent/protocol.js';
import { runSession, type SessionOptions } from './session.js';

export async function startBackground(options:SessionOptions) {
  if(!options.name)throw new Error('--headless requires --session NAME.');
  if(options.cdp)throw new Error('--headless cannot be combined with --cdp.');
  const name=validateSessionName(options.name);
  try {await sendAgent(name,{command:'attach',args:[]});throw new AgentError('session_in_use',`Session "${name}" is already running. Use attach ${name} --view or agent commands.`);}
  catch(error){if(!(error instanceof AgentError)||error.code!=='session_not_running')throw error;}
  const directory=join(sessionsRoot(),name);await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  const logPath=join(directory,'background.log'), log=await open(logPath,'a',0o600);
  try {
    const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];
    const child=fork(fileURLToPath(import.meta.url),['--worker'],{cwd:process.cwd(),env,detached:true,stdio:['ignore',log.fd,log.fd,'ipc'],execArgv:[]});
    try {
      const info=await new Promise<unknown>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error(`Background startup timed out. See ${logPath}`)),180000);
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`Background startup exited (${code??signal}). See ${logPath}`));});
        child.once('message',(message:any)=>{clearTimeout(timer);message.ok?resolve(message.result):reject(new Error(message.error));});
        child.send(options);
      });
      child.disconnect();child.unref();return info;
    }catch(error){child.kill('SIGTERM');if(child.connected)child.disconnect();child.unref();throw error;}
  }finally{await log.close();}
}
export async function stopNamedSession(name:string) {
  await sendAgent(name,{command:'stop',args:[]});
  const end=Date.now()+15000;
  while(Date.now()<end) {
    if(!(await listSessions()).find(session=>session.name===name)?.active)return {session:name,stopped:true};
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Session "${name}" is still closing. Check sessions list before restarting it.`);
}
if(process.argv[2]==='--worker') {
  process.once('message',(options:SessionOptions)=>{
    void runSession({...options,headless:true},result=>{process.send?.({ok:true,result});}).catch(error=>{
      if(process.connected)process.send?.({ok:false,error:String(error instanceof Error?error.message:error)});
      process.stderr.write(String(error?.stack??error)+'\n');process.exitCode=1;
    });
  });
}
