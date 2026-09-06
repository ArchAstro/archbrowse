import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHerdrGraphics } from '../src/herdr.js';

test('HerdR disabled rendering fails despite the virtual terminal Kitty OK reply',async()=> {
  const dir=await mkdtemp(join(tmpdir(),'archbrowse-herdr-'));
  const socket=join(dir,'api.sock');let pending=0;let requests=0;let response:unknown={id:'archbrowse:graphics',error:{code:'feature_disabled',message:'pane graphics require experimental.kitty_graphics'}};
  const server=createServer(client=>client.once('data',data=> {
    const request=JSON.parse(data.toString());assert.equal(request.params.pane_id,'w1:p2');
    requests++;const result=pending-->0 ? {error:{code:'cell_size_unavailable',message:'negotiating'}} : response;
    const bytes=JSON.stringify(result)+'\n';client.write(bytes.slice(0,10));setImmediate(()=>client.end(bytes.slice(10)));
  }));
  await new Promise<void>(yes=>server.listen(socket,yes));
  const env={HERDR_ENV:'1',HERDR_SOCKET_PATH:socket,HERDR_PANE_ID:'w1:p2'};
  try {
    await assert.rejects(()=>checkHerdrGraphics(env),/HerdR image rendering is disabled/);
    response={result:{type:'pane_graphics_info',cell_width_px:8,cell_height_px:16}};await checkHerdrGraphics(env);
    pending=2;const before=requests;await checkHerdrGraphics(env,{timeoutMs:1000,retryMs:5});assert.equal(requests-before,3);
    response={error:{code:'cell_size_unavailable',message:'host cell size is unavailable'}};await assert.rejects(()=>checkHerdrGraphics(env,{timeoutMs:20,retryMs:5}),/cannot hot-reload/);
    response={error:{code:'pane_not_found',message:'no pane'}};await assert.rejects(()=>checkHerdrGraphics(env),/pane_not_found/);
    await checkHerdrGraphics({});
    await assert.rejects(()=>checkHerdrGraphics({HERDR_ENV:'1'}),/context is incomplete/);
  }finally {await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
