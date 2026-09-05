import { mkdir, readFile, readdir, rename, rm, writeFile, chmod, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import type { BrowserContext } from 'playwright-core';

export interface SessionRecord {
  version:1; name:string; createdAt:string; updatedAt:string;
  target:string; root?:string; port?:number;
  mobile?:{width:number;height:number}; tabs:string[]; activeTab:number;
}
export function sessionsRoot() {
  return resolve(process.env.REACT_KITTY_SESSIONS_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(),'.local','share'),'react-kitty','sessions'));
}
export function validateSessionName(name:string) {
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Session names must be 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.');
  return name;
}
export async function readSession(name:string):Promise<SessionRecord|undefined> {
  const path=join(sessionsRoot(),validateSessionName(name),'session.json');
  let text:string;
  try { text=await readFile(path,'utf8'); } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return; throw error; }
  const record=JSON.parse(text) as SessionRecord;
  if(record.version!==1 || record.name!==name || typeof record.target!=='string' || !Array.isArray(record.tabs) || !record.tabs.every(url=>typeof url==='string' && /^https?:\/\//i.test(url)) || !Number.isInteger(record.activeTab)) throw new Error(`Invalid session metadata for ${name}.`);
  return record;
}
async function atomicJson(path:string,value:unknown) {
  const temp=path+'.'+randomUUID()+'.tmp';
  try { await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600}); await rename(temp,path); }
  finally { await rm(temp,{force:true}); }
}
export async function acquireSession(name:string) {
  validateSessionName(name);
  const root=sessionsRoot(), directory=join(root,name);
  await mkdir(root,{recursive:true,mode:0o700}); await chmod(root,0o700);
  let release:()=>Promise<void>;
  try { release=await lockfile.lock(directory,{realpath:false,stale:10000,update:2000,retries:0}); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='ELOCKED') throw new Error(`Session "${name}" is in use. Close its other CLI first; after a crash, wait 10 seconds and retry.`); throw error; }
  try { await mkdir(directory,{recursive:true,mode:0o700}); await chmod(directory,0o700); }
  catch(error) { await release(); throw error; }
  return {
    name, directory, profile:join(directory,'profile'), release,
    read:()=>readSession(name),
    save:(record:SessionRecord)=>atomicJson(join(directory,'session.json'),record),
    async saveCookies(context:BrowserContext) { await atomicJson(join(directory,'cookies.json'),await context.cookies()); },
    async restoreCookies(context:BrowserContext) {
      let cookies:Awaited<ReturnType<BrowserContext['cookies']>>;
      try { cookies=JSON.parse(await readFile(join(directory,'cookies.json'),'utf8')); }
      catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return; throw error; }
      // Chromium's profile owns durable cookies. Reapply only session cookies,
      // which Chromium normally discards when its process exits.
      await context.addCookies(cookies.filter(cookie=>cookie.expires===-1));
    },
  };
}
export async function listSessions() {
  const root=sessionsRoot();
  const entries=await readdir(root,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=> { if(error.code==='ENOENT') return []; throw error; });
  const sessions=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)) continue;
    const record=await readSession(entry.name);
    sessions.push({name:entry.name,active:await lockfile.check(join(root,entry.name),{realpath:false,stale:10000}),updatedAt:record?.updatedAt ?? null});
  }
  return sessions;
}
export async function deleteSession(name:string) {
  validateSessionName(name);
  const info=await stat(join(sessionsRoot(),name)).catch((error:NodeJS.ErrnoException)=> { if(error.code==='ENOENT') return; throw error; });
  if(!info?.isDirectory()) throw new Error(`Session "${name}" does not exist.`);
  const session=await acquireSession(name);
  try { await rm(session.directory,{recursive:true}); }
  finally { await session.release(); }
}
