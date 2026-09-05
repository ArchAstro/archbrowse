import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionsRoot, validateSessionName } from '../sessions.js';
export const MAX_MESSAGE=32*1024*1024;
export interface AgentRequest {command:string;args:string[];interactive?:boolean;full?:boolean;timeout?:number;text?:string;url?:string}
export interface AgentReply {ok:boolean;result?:unknown;error?:{code:string;message:string}}
export class AgentError extends Error {constructor(public code:string,message:string){super(message);this.name='AgentError';}}
export function agentSocket(name:string) {
  validateSessionName(name);
  const path=join(sessionsRoot(),name,'agent.sock');
  if(process.platform==='win32')return '\\\\.\\pipe\\react-kitty-'+createHash('sha256').update(path).digest('hex').slice(0,32);
  const socket=Buffer.byteLength(path)>100?join(tmpdir(),'rk-'+createHash('sha256').update(path).digest('hex').slice(0,16),'s'):path;
  if(Buffer.byteLength(socket)>100)throw new AgentError('socket_path_too_long','Runtime socket path is too long. Use a shorter TMPDIR.');
  return socket;
}
export const agentCommands=new Set(['attach','snapshot','read','click','dblclick','hover','focus','fill','type','press','check','uncheck','select','scroll','get','wait','screenshot','open','back','forward','reload','tab','eval']);
export function validateRequest(value:unknown):AgentRequest {
  if(!value||typeof value!=='object')throw new AgentError('invalid_request','Expected a command request.');
  const r=value as AgentRequest;
  if(!agentCommands.has(r.command)||!Array.isArray(r.args)||!r.args.every(a=>typeof a==='string'))throw new AgentError('invalid_request','Unknown command or invalid arguments.');
  if(r.timeout!==undefined&&(!Number.isInteger(r.timeout)||r.timeout<1||r.timeout>30000))throw new AgentError('invalid_request','Timeout must be 1–30000 milliseconds.');
  for(const flag of ['interactive','full'] as const)if(r[flag]!==undefined&&typeof r[flag]!=='boolean')throw new AgentError('invalid_request',`Invalid ${flag} flag.`);
  for(const flag of ['text','url'] as const)if(r[flag]!==undefined&&typeof r[flag]!=='string')throw new AgentError('invalid_request',`Invalid ${flag} option.`);
  return r;
}
