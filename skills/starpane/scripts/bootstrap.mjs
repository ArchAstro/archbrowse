#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm, realpath, symlink, lstat, writeFile, copyFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
const exec=promisify(execFile);
const repository='calvin-archastro/starpane';
function paths(env=process.env){const data=env.XDG_DATA_HOME??join(homedir(),'.local','share');return {install:resolve(env.STARPANE_INSTALL_DIR??join(data,'starpane','cli')),bin:resolve(env.STARPANE_BIN_DIR??join(homedir(),'.local','bin'))};}
async function exists(path){try{await access(path);return true;}catch{return false;}}
async function verify(command){try{const {stdout}=await exec(command[0],[...command.slice(1),'--help'],{timeout:15000});return stdout.startsWith('starpane —')&&stdout.includes('snapshot');}catch{return false;}}
export async function status(env=process.env){
  const {install,bin}=paths(env);
  const candidates=[...(env.PATH??'').split(delimiter).filter(Boolean).map(dir=>join(dir,process.platform==='win32'?'starpane.cmd':'starpane')),join(bin,'starpane'),join(install,'node_modules','starpane','dist','cli.js')];
  for(const candidate of [...new Set(candidates)])if(await exists(candidate)){
    let command=candidate.endsWith('.js')?[process.execPath,candidate]:[candidate];
    if(process.platform==='win32'&&candidate.endsWith('.cmd')){
      const entries=[join(dirname(candidate),'node_modules','starpane','dist','cli.js'),join(dirname(candidate),'..','starpane','dist','cli.js')];
      const entry=(await Promise.all(entries.map(exists))).findIndex(Boolean);if(entry<0)continue;command=[process.execPath,entries[entry]];
    }
    if(await verify(command))return {installed:true,command,installDirectory:install,binDirectory:bin};
  }
  return {installed:false,command:null,installDirectory:install,binDirectory:bin};
}
async function npm(args,options){
  if(process.platform!=='win32')return exec('npm',args,options);
  // Windows .cmd shims cannot be executed directly with execFile. Invoke npm's
  // JavaScript entrypoint through Node, without constructing a shell command.
  for(const dir of [dirname(process.execPath),...(options.env.PATH??'').split(delimiter)]){
    const cli=join(dir,'node_modules','npm','bin','npm-cli.js');
    if(await exists(cli))return exec(process.execPath,[cli,...args],options);
  }
  throw new Error('Cannot locate npm-cli.js. Install npm with your Node.js distribution.');
}
async function localSource(){
  let path=dirname(fileURLToPath(import.meta.url));
  while(dirname(path)!==path){
    try{const pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'));if(pkg.name==='starpane')return path;}catch{}
    path=dirname(path);
  }
}
export async function install({source,env=process.env,log=message=>process.stderr.write(message+'\n')}={}){
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Starpane requires Node.js 22+. Install/select Node 22+ with your normal version manager first.');
  const current=await status(env);if(current.installed)return {...current,changed:false};
  const locations=paths(env);await mkdir(locations.install,{recursive:true});
  let checkout=source?await realpath(resolve(source)):await localSource();
  if(!checkout){
    checkout=join(locations.install,'source');
    if(!await exists(join(checkout,'package.json'))){
      log(`Fetching ${repository}. Private repositories require authenticated GitHub access.`);
      await exec('gh',['repo','clone',repository,checkout,'--','--depth=1'],{env,timeout:120000});
    }
  }
  const pkg=JSON.parse(await readFile(join(checkout,'package.json'),'utf8'));
  if(pkg.name!=='starpane')throw new Error(`Expected the Starpane source/package at ${checkout}.`);
  const sourceTree=await exists(join(checkout,'tsconfig.json'));
  if(sourceTree){
    if(!await exists(join(checkout,'node_modules','typescript','bin','tsc'))){log('Installing build dependencies…');await npm(['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:checkout,env,timeout:180000,maxBuffer:8*1024*1024});}
    log('Building Starpane…');await npm(['run','build'],{cwd:checkout,env,timeout:120000,maxBuffer:8*1024*1024});
  }
  if(!await exists(join(checkout,'dist','cli.js')))throw new Error('The Starpane build did not produce dist/cli.js.');
  const temp=await mkdtemp(join(tmpdir(),'starpane-install-'));
  try{
    const {stdout}=await npm(['pack','--json','--ignore-scripts','--pack-destination',temp],{cwd:checkout,env,timeout:120000});
    const filename=JSON.parse(stdout)[0].filename,archive=join(locations.install,filename);
    await copyFile(join(temp,filename),archive);
    log('Installing the user-local CLI…');
    await npm(['install','--prefix',locations.install,'--omit=dev','--ignore-scripts','--no-audit','--no-fund',archive],{env,timeout:180000,maxBuffer:8*1024*1024});
  }finally{await rm(temp,{recursive:true,force:true});}
  const entry=join(locations.install,'node_modules','starpane','dist','cli.js'),command=[process.execPath,entry];
  if(!await verify(command))throw new Error('Installed CLI failed the Starpane identity/help check.');
  await mkdir(locations.bin,{recursive:true});const shim=join(locations.bin,process.platform==='win32'?'starpane.cmd':'starpane');
  const prior=await lstat(shim).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(prior)throw new Error(`CLI installed at ${entry}, but ${shim} already exists. Use the returned installation directly or resolve that path conflict; it was not overwritten.`);
  if(process.platform==='win32')await writeFile(shim,`@echo off\r\n"${process.execPath}" "${entry}" %*\r\n`);
  else await symlink(join(locations.install,'node_modules','.bin','starpane'),shim);
  return {installed:true,changed:true,command,launcher:shim,installDirectory:locations.install,binDirectory:locations.bin,pathContainsLauncher:(env.PATH??'').split(delimiter).includes(locations.bin),source:checkout};
}
async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{source:{type:'string'}}});
  if(positionals.length>1)throw new Error('Use status or install [--source PATH].');
  const action=positionals[0]??'status';
  const result=action==='status'?await status():action==='install'?await install({source:values.source}):null;
  if(!result)throw new Error('Use status or install [--source PATH].');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`starpane bootstrap: ${error.message}${error.stderr?'\n'+error.stderr:''}\n`);process.exitCode=1;});
