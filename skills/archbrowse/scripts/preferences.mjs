#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, rm, realpath } from 'node:fs/promises';
import { realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const choices={host:['herdr','terminal','tmux'],placement:['split','tab','current'],sessionPolicy:['workspace','fresh','named','ask'],focus:['keep','viewer'],splitDirection:['auto','right','down'],browserDownload:['if-missing','never'],terminalProgram:['manual','kitty','ghostty','wezterm']};
const optionalDefaults={focus:'keep',splitDirection:'auto',browserDownload:'if-missing',mobile:false,terminalProgram:'manual'};
export function preferencesPath(env=process.env){
  const override=env.ARCHBROWSE_PREFERENCES_FILE??env.STARPANE_PREFERENCES_FILE;if(override)return resolve(override);
  const base=env.XDG_CONFIG_HOME??join(homedir(),'.config');
  const paths=['archbrowse','starpane'].map(name=>join(base,name,'preferences.json'));
  return resolve(paths.find(path=>existsSync(path))??paths[0]);
}
export async function workspacePath(path=process.cwd()){
  const directory=await realpath(resolve(path));
  try{return await realpath(execFileSync('git',['-C',directory,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{return directory;}
}
function validate(settings,partial=false){
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new Error('Preferences must be an object.');
  for(const [key,value] of Object.entries(settings)){
    if(choices[key]){if(!choices[key].includes(value))throw new Error(`${key} must be one of: ${choices[key].join(', ')}`);}
    else if(key==='mobile'){if(typeof value!=='boolean')throw new Error('mobile must be true or false.');}
    else if(key==='sessionName'){if(typeof value!=='string'||! /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))throw new Error('Invalid named ArchBrowse session.');}
    else throw new Error(`Unknown preference: ${key}`);
  }
  if(!partial){for(const key of ['host','placement','sessionPolicy'])if(!settings[key])throw new Error(`Missing preference: ${key}`);if(settings.sessionPolicy==='named'&&!settings.sessionName)throw new Error('Named policy requires sessionName.');}
}
export async function readPreferences(env=process.env){
  let text;try{text=await readFile(preferencesPath(env),'utf8');}catch(error){if(error.code==='ENOENT')return {version:1,workspaces:{}};throw error;}
  const data=JSON.parse(text);
  if(data.version!==1||!data.workspaces||typeof data.workspaces!=='object'||Array.isArray(data.workspaces))throw new Error('Invalid ArchBrowse preferences file; refusing to replace it.');
  if(data.defaults)validate(data.defaults);
  for(const value of Object.values(data.workspaces))validate(value,true);
  return data;
}
async function workspaceOverride(data,path){
  if(data.workspaces[path])return {key:path,value:data.workspaces[path]};
  // Old worktree paths may remain valid aliases after a project rename.
  for(const [key,value] of Object.entries(data.workspaces))if(await realpath(key).catch(()=>null)===path)return {key,value};
  return {key:path,value:undefined};
}
export async function showPreferences(workspace,env=process.env){
  const data=await readPreferences(env),path=await workspacePath(workspace);
  const override=await workspaceOverride(data,path);
  const effective={...optionalDefaults,...data.defaults,...override.value};
  let configured=true;try{validate(effective);}catch{configured=false;}
  return {path:preferencesPath(env),workspace:path,configured,effective,defaults:data.defaults??null,override:override.value??null};
}
export async function savePreferences(patch,{workspace,env=process.env}={}){
  validate(patch,true);const data=await readPreferences(env);
  if(workspace){const key=await workspacePath(workspace),old=await workspaceOverride(data,key);const value={...old.value,...patch};validate({...optionalDefaults,...data.defaults,...value});if(old.key!==key)delete data.workspaces[old.key];data.workspaces[key]=value;}
  else {data.defaults={...optionalDefaults,...data.defaults,...patch};validate(data.defaults);}
  const path=preferencesPath(env),temp=path+'.'+randomBytes(6).toString('hex')+'.tmp';
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
  return showPreferences(workspace,env);
}
export async function planLaunch(workspace,overrides={},env=process.env){
  const saved=await showPreferences(workspace,env),settings={...saved.effective,...overrides};
  try{validate(settings);}catch(error){return {...saved,status:'needs-setup',reason:error.message};}
  if(settings.host==='tmux')return {...saved,settings,status:'unsupported-host',reason:'ArchBrowse does not render inside tmux yet. Keep this preference, but use a compatible viewer outside tmux or attach to an existing live session; do not use --force.'};
  if(settings.host==='herdr' && !(env.HERDR_ENV==='1'&&env.HERDR_SOCKET_PATH&&env.HERDR_WORKSPACE_ID&&env.HERDR_PANE_ID))return {...saved,settings,status:'host-unavailable',reason:'Launch from a HerdR-managed pane or choose an available terminal. Do not control a focused HerdR session from outside it.'};
  if(settings.sessionPolicy==='ask')return {...saved,settings,status:'needs-session-choice'};
  const identity=settings.host==='herdr'?`${resolve(env.HERDR_SOCKET_PATH)}#${env.HERDR_WORKSPACE_ID}`:saved.workspace;
  const label=(settings.host==='herdr'?env.HERDR_WORKSPACE_ID:basename(saved.workspace)).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').slice(0,28)||'workspace';
  const suffix=settings.sessionPolicy==='fresh'?Date.now().toString(36)+'-'+randomBytes(3).toString('hex'):createHash('sha256').update(identity).digest('hex').slice(0,10);
  // Session IDs stay stable across product renames so existing viewers are reused.
  const session=settings.sessionPolicy==='named'?settings.sessionName:`sp-${label}-${suffix}`;
  return {path:saved.path,workspace:saved.workspace,settings,status:'ready',session,reuse:settings.sessionPolicy!=='fresh',viewerFlags:[...(settings.browserDownload==='never'?['--no-install']:[]),...(settings.mobile?['--mobile']:[])]};
}
async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{workspace:{type:'string'},file:{type:'string'},host:{type:'string'},placement:{type:'string'},sessions:{type:'string'},name:{type:'string'},focus:{type:'string'},direction:{type:'string'},'browser-download':{type:'string'},'terminal-program':{type:'string'},mobile:{type:'boolean'},desktop:{type:'boolean'}}});
  const action=positionals[0]??'show';if(positionals.length>1)throw new Error('Expected show, set or plan.');
  const patch={};for(const [flag,key] of Object.entries({host:'host',placement:'placement',sessions:'sessionPolicy',name:'sessionName',focus:'focus',direction:'splitDirection','browser-download':'browserDownload','terminal-program':'terminalProgram'}))if(values[flag]!==undefined)patch[key]=values[flag];
  if(values.mobile&&values.desktop)throw new Error('Choose --mobile or --desktop.');if(values.mobile)patch.mobile=true;if(values.desktop)patch.mobile=false;
  let result;
  if(action==='show')result=await showPreferences(values.workspace);
  else if(action==='set'){if(values.file)Object.assign(patch,JSON.parse(await readFile(values.file,'utf8')));result=await savePreferences(patch,{workspace:values.workspace});}
  else if(action==='plan')result=await planLaunch(values.workspace,patch);
  else throw new Error('Use show, set or plan.');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`archbrowse preferences: ${error.message}\n`);process.exitCode=1;});
