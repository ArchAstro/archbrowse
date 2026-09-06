import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showPreferences, savePreferences, planLaunch, preferencesPath } from '../skills/archbrowse/scripts/preferences.mjs';

test('skill preferences persist choices, apply workspace overrides, and isolate session identities',async()=> {
  const root=await mkdtemp(join(tmpdir(),'archbrowse-skill-prefs-'));const a=join(root,'project-a'),b=join(root,'project-b');await mkdir(a);await mkdir(b);
  const env={ARCHBROWSE_PREFERENCES_FILE:join(root,'config','preferences.json'),HERDR_ENV:'1',HERDR_WORKSPACE_ID:'w1',HERDR_PANE_ID:'w1:p1',HERDR_SOCKET_PATH:join(root,'herdr.sock')};
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

test('skill reuses Starpane preferences and honors both environment names',async()=> {
  const root=await mkdtemp(join(tmpdir(),'archbrowse-preference-compat-'));
  const legacy=join(root,'starpane','preferences.json'),current=join(root,'archbrowse','preferences.json');
  const env={XDG_CONFIG_HOME:root};
  try {
    assert.equal(preferencesPath(env),current);
    await mkdir(join(root,'starpane'),{recursive:true});
    await writeFile(legacy,JSON.stringify({version:1,defaults:{host:'herdr',placement:'split',sessionPolicy:'workspace'},workspaces:{}}));
    assert.equal(preferencesPath(env),legacy);assert.equal((await showPreferences(root,env)).effective.placement,'split');
    assert.equal(preferencesPath({...env,STARPANE_PREFERENCES_FILE:legacy}),legacy);
    assert.equal(preferencesPath({...env,STARPANE_PREFERENCES_FILE:legacy,ARCHBROWSE_PREFERENCES_FILE:current}),current);
    const project=join(root,'renamed-project'),alias=join(root,'old-project');await mkdir(project);await symlink(project,alias);
    await writeFile(legacy,JSON.stringify({version:1,defaults:{host:'terminal',placement:'current',sessionPolicy:'workspace'},workspaces:{[alias]:{placement:'tab'}}}));
    assert.equal((await showPreferences(project,env)).effective.placement,'tab');
    await savePreferences({focus:'viewer'},{workspace:project,env});
    const settings=await showPreferences(project,env);assert.equal(settings.effective.placement,'tab');assert.equal(settings.effective.focus,'viewer');
  }finally{await rm(root,{recursive:true,force:true});}
});
