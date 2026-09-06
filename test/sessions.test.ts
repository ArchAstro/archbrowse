import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSession, listSessions, deleteSession, validateSessionName } from '../src/sessions.js';

test('named session lock, atomic metadata, private permissions and active deletion guard',async()=> {
  const root=await mkdtemp(join(tmpdir(),'archbrowse-session-unit-'));
  const original=process.env.ARCHBROWSE_SESSIONS_DIR; process.env.ARCHBROWSE_SESSIONS_DIR=root;
  let session:Awaited<ReturnType<typeof acquireSession>>|undefined;
  try {
    for(const bad of ['../other','../','A','a/b','.hidden','a'.repeat(65)]) assert.throws(()=>validateSessionName(bad));
    session=await acquireSession('work');
    await assert.rejects(()=>acquireSession('work'),/in use/);
    await assert.rejects(()=>deleteSession('work'),/in use/);
    const record={version:1 as const,name:'work',createdAt:'2026-09-05',updatedAt:'2026-09-05',target:'https://example.com/',tabs:['https://example.com/'],activeTab:0};
    await session.save(record); assert.deepEqual(await session.read(),record);
    assert.equal((await listSessions())[0].active,true);
    if(process.platform!=='win32') {
      assert.equal((await stat(root)).mode & 0o777,0o700);
      assert.equal((await stat(join(session.directory,'session.json'))).mode & 0o777,0o600);
    }
    await session.release(); session=undefined;
    assert.equal((await listSessions())[0].active,false);
    await deleteSession('work'); assert.deepEqual(await listSessions(),[]);
    await assert.rejects(()=>deleteSession('work'),/does not exist/);
  } finally {
    await session?.release();
    if(original===undefined) delete process.env.ARCHBROWSE_SESSIONS_DIR; else process.env.ARCHBROWSE_SESSIONS_DIR=original;
    await rm(root,{recursive:true,force:true});
  }
});
