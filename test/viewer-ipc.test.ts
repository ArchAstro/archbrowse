import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serveViewer } from '../src/viewer-server.js';
import { viewerSocket } from '../src/viewer-protocol.js';

test('viewer socket rejects bad geometry and concurrent viewers, then releases its lease on disconnect',async()=>{
  const root=await mkdtemp(join(tmpdir(),'archbrowse-viewer-ipc-')),previous=process.env.ARCHBROWSE_SESSIONS_DIR;
  process.env.ARCHBROWSE_SESSIONS_DIR=root;const clients:Socket[]=[];let releases=0;
  const server=await serveViewer('test',{configure:async()=>{},input:async event=>{if(event.type==='focus'&&!event.focused)releases++;},frame:()=>undefined},15);
  function request(value:unknown){return new Promise<{socket:Socket;reply:any}>((resolve,reject)=>{
    const socket=createConnection(viewerSocket('test'),()=>socket.write(JSON.stringify(value)+'\n'));clients.push(socket);socket.on('error',reject);let data='';socket.on('data',chunk=>{data+=chunk;const end=data.indexOf('\n');if(end>=0)resolve({socket,reply:JSON.parse(data.slice(0,end))});});
  });}
  const attach={type:'attach',geometry:{columns:100,rows:40,cellWidth:8,cellHeight:16},pixel:true};
  try{
    assert.equal((await request({...attach,geometry:{...attach.geometry,columns:-1}})).reply.type,'error');
    assert.equal(server.attached,false);
    const first=await request(attach);assert.equal(first.reply.type,'ready');
    assert.equal((await request(attach)).reply.code,'viewer_busy');assert.equal(server.attached,true);
    first.socket.destroy();const deadline=Date.now()+3000;
    while(server.attached&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(server.attached,false);assert.equal(releases,1);
    assert.equal((await request(attach)).reply.type,'ready');
  }finally{
    for(const socket of clients)socket.destroy();await server.close();
    if(previous===undefined)delete process.env.ARCHBROWSE_SESSIONS_DIR;else process.env.ARCHBROWSE_SESSIONS_DIR=previous;
    await rm(root,{recursive:true,force:true});
  }
});
