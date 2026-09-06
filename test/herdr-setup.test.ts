import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { enableGraphics, planHerdrSetup, applyHerdrSetup, offerHerdrSetup } from '../src/herdr-setup.js';
import { HerdrCapabilityError } from '../src/herdr.js';

test('TOML edits preserve comments and support tables, dotted keys, inline and quoted keys',()=> {
  for(const original of [
    '# theme\n[experimental]\nkitty_graphics = false # keep\nother = "unchanged"\n',
    'experimental.kitty_graphics = false # keep\n',
    'experimental = { kitty_graphics = false, other = "keep" }\n',
    '["experimental"]\n"kitty_graphics" = false\n',
  ])assert.equal(enableGraphics(original).text,original.replace('false','true'));
  const before='# keep\r\n[experimental] # existing\r\nother = true\r\n';
  assert.equal(enableGraphics(before).text,'# keep\r\n[experimental] # existing\r\nkitty_graphics = true\r\nother = true\r\n');
  for(const original of ['', '[theme]\nname="tokyo-night"\n', 'experimental = { other = true }\n', 'experimental.other = true\n', '[experimental.other]\nvalue=true\n', '"experimental.kitty_graphics" = false\n']) {
    const edited=enableGraphics(original);assert.equal(edited.changed,true);assert.equal(enableGraphics(edited.text).changed,false);
    if(original.includes('"experimental.kitty_graphics"'))assert.ok(edited.text.includes('"experimental.kitty_graphics" = false'));
  }
  assert.equal(enableGraphics('[experimental]\nkitty_graphics=true\n').changed,false);
  assert.throws(()=>enableGraphics('experimental = 3'));
  assert.throws(()=>enableGraphics('[invalid'));
});
test('setup declines safely, backs up on approval, preserves symlinks and detects concurrent edits',async()=> {
  const root=await mkdtemp(join(tmpdir(),'archbrowse-config-test-'));const target=join(root,'dotfile.toml'),config=join(root,'config.toml');
  const original='[theme]\nname="tokyo-night" # keep\n';await writeFile(target,original);await symlink(target,config);
  const env={HERDR_CONFIG_PATH:config};const error=new HerdrCapabilityError('feature_disabled','disabled');let reloads=0;
  try{
    await assert.rejects(()=>offerHerdrSetup(error,{env,confirm:async()=>false,reload:async()=>{reloads++;},write:()=>{}}),/declined/);
    assert.equal(await readFile(target,'utf8'),original);assert.equal((await readdir(root)).length,2);
    const plan=await planHerdrSetup(env);await writeFile(target,original+'# concurrent edit\n');await assert.rejects(()=>applyHerdrSetup(plan),/changed while the prompt/);await writeFile(target,original);
    assert.equal(await offerHerdrSetup(error,{env,confirm:async question=>{assert.ok(question.includes(target));return true;},reload:async()=>{reloads++;},write:()=>{}}),true);
    assert.equal(reloads,1);assert.equal((await lstat(config)).isSymbolicLink(),true);
    const backup=(await readdir(root)).find(file=>file.endsWith('.bak'))!;assert.equal(await readFile(join(root,backup),'utf8'),original);
    assert.ok((await readFile(target,'utf8')).startsWith(original));
    let prompted=false;
    await assert.rejects(()=>offerHerdrSetup(new HerdrCapabilityError('cell_size_unavailable','missing'),{env,confirm:async()=>{prompted=true;return true;}}),/already enabled/);
    assert.equal(prompted,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
