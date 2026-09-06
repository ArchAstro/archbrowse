import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveAgent, sendAgent } from '../src/agent/ipc.js';
import { agentSocket, AgentError } from '../src/agent/protocol.js';

test('agent socket isolates names, preserves errors and disappears on shutdown',async()=> {
  const root=await mkdtemp(join(tmpdir(),'starpane-agent-ipc-')),previous=process.env.STARPANE_SESSIONS_DIR;
  process.env.STARPANE_SESSIONS_DIR=join(root,'deliberately-long-profile-path-to-exercise-the-short-socket-fallback');
  let server:Awaited<ReturnType<typeof serveAgent>>|undefined;
  try {
    server=await serveAgent('work',async request=>{if(request.command==='click')throw new AgentError('stale_ref','Take another snapshot.');return {args:request.args};});
    assert.deepEqual(await sendAgent('work',{command:'get',args:['url']}),{args:['url']});
    await assert.rejects(()=>sendAgent('work',{command:'click',args:['@e1']}),error=>error instanceof AgentError&&error.code==='stale_ref');
    await assert.rejects(()=>sendAgent('other',{command:'attach',args:[]}),error=>error instanceof AgentError&&error.code==='session_not_running');
    if(process.platform!=='win32')assert.equal((await lstat(agentSocket('work'))).mode&0o777,0o600);
    await server.close();server=undefined;
    await assert.rejects(()=>sendAgent('work',{command:'attach',args:[]}),error=>error instanceof AgentError&&error.code==='session_not_running');
  }finally{await server?.close();if(previous===undefined)delete process.env.STARPANE_SESSIONS_DIR;else process.env.STARPANE_SESSIONS_DIR=previous;await rm(root,{recursive:true,force:true});}
});
