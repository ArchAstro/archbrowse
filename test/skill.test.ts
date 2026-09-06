import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showPreferences, savePreferences, planLaunch, preferencesPath } from '../skills/starpane/scripts/preferences.mjs';

test('skill preferences persist choices, apply workspace overrides, and isolate session identities',async()=> {
  const root=await mkdtemp(join(tmpdir(),'starpane-skill-prefs-'));const a=join(root,'project-a'),b=join(root,'project-b');await mkdir(a);await mkdir(b);
  const env={STARPANE_PREFERENCES_FILE:join(root,'config','preferences.json'),HERDR_ENV:'1',HERDR_WORKSPACE_ID:'w1',HERDR_PANE_ID:'w1:p1',HERDR_SOCKET_PATH:join(root,'herdr.sock')};
  try{
    assert.equal((await showPreferences(a,env)).configured,false);
    await savePreferences({host:'herdr',placement:'split',sessionPolicy:'workspace'},{env});
    const first=await planLaunch(a,{},env);assert.equal(first.status,'ready');assert.equal(first.settings.focus,'keep');assert.equal(first.reuse,true);
    assert.equal((await planLaunch(b,{},env)).session,first.session,'same HerdR workspace reuses its viewer across cwd changes');
    assert.notEqual((await planLaunch(a,{}, {...env,HERDR_WORKSPACE_ID:'w2'})).session,first.session);
    await savePreferences({placement:'tab'},{workspace:b,env});assert.equal((await planLaunch(b,{},env)).settings.placement,'tab');assert.equal((await planLaunch(a,{},env)).settings.placement,'split');
    const fresh=await planLaunch(a,{sessionPolicy:'fresh'},env);assert.equal(fresh.reuse,false);assert.notEqual(fresh.session,(await planLaunch(a,{sessionPolicy:'fresh'},env)).session);
    assert.equal((await planLaunch(a,{sessionPolicy:'ask'},env)).status,'needs-session-choice');
    assert.equal((await planLaunch(a,{host:'tmux'},env)).status,'unsupported-host');assert.equal((await showPreferences(a,env)).effective.host,'herdr','one-off choice does not overwrite defaults');
    assert.equal((await planLaunch(a,{}, {...env,HERDR_ENV:''})).status,'host-unavailable');
    if(process.platform!=='win32')assert.equal((await stat(preferencesPath(env))).mode&0o777,0o600);
    const original=await readFile(preferencesPath(env),'utf8');await assert.rejects(()=>savePreferences({host:'unknown'},{env}));assert.equal(await readFile(preferencesPath(env),'utf8'),original);
    await writeFile(preferencesPath(env),'{broken');await assert.rejects(()=>savePreferences({placement:'tab'},{env}));assert.equal(await readFile(preferencesPath(env),'utf8'),'{broken');
  }finally{await rm(root,{recursive:true,force:true});}
});
