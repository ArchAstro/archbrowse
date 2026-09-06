import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionsRoot, acquireSession, listSessions } from '../src/sessions.js';
import { serveAgent, sendAgent } from '../src/agent/ipc.js';
import { agentSocket } from '../src/agent/protocol.js';

test('Starpane reuses legacy sessions and live endpoints; new env names take precedence',async()=> {
  const root=await mkdtemp(join(tmpdir(),'starpane-compat-'));
  const keys=['STARPANE_SESSIONS_DIR','REACT_KITTY_SESSIONS_DIR','XDG_DATA_HOME'] as const;
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let session:Awaited<ReturnType<typeof acquireSession>>|undefined,server:Awaited<ReturnType<typeof serveAgent>>|undefined;
  try {
    delete process.env.STARPANE_SESSIONS_DIR;delete process.env.REACT_KITTY_SESSIONS_DIR;process.env.XDG_DATA_HOME=root;
    const current=join(root,'starpane','sessions'),legacy=join(root,'react-kitty','sessions');
    assert.equal(sessionsRoot(),current);
    await mkdir(legacy,{recursive:true});assert.equal(sessionsRoot(),legacy);
    session=await acquireSession('work');
    await session.save({version:1,name:'work',createdAt:'2026-09-05',updatedAt:'2026-09-05',target:'https://example.com/',tabs:['https://example.com/'],activeTab:0});
    assert.equal((await listSessions())[0].name,'work');
    const endpoint=agentSocket('work');
    server=await serveAgent('work',async()=>({session:'work'}));
    process.env.STARPANE_SESSIONS_DIR=legacy;assert.equal(agentSocket('work'),endpoint);
    assert.deepEqual(await sendAgent('work',{command:'attach',args:[]}),{session:'work'});
    await server.close();server=undefined;await session.release();session=undefined;
    delete process.env.STARPANE_SESSIONS_DIR;process.env.REACT_KITTY_SESSIONS_DIR=legacy;assert.equal(sessionsRoot(),legacy);
    process.env.STARPANE_SESSIONS_DIR=current;assert.equal(sessionsRoot(),current);
    delete process.env.STARPANE_SESSIONS_DIR;delete process.env.REACT_KITTY_SESSIONS_DIR;
    await mkdir(current,{recursive:true});assert.equal(sessionsRoot(),current);
  }finally {
    await server?.close();await session?.release();
    for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
    await rm(root,{recursive:true,force:true});
  }
});
