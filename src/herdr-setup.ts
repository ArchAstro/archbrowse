import { parseForESLint, getStaticTOMLValue, traverseNodes, type AST } from 'toml-eslint-parser';
import { readFile, realpath, stat, mkdir, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { HerdrCapabilityError, reloadHerdrConfig } from './herdr.js';

export function herdrConfigPath(env:NodeJS.ProcessEnv=process.env) {
  return resolve(env.HERDR_CONFIG_PATH ?? join(env.XDG_CONFIG_HOME ?? join(homedir(),'.config'),'herdr','config.toml'));
}
function key(node:AST.TOMLKeyValue): (string|number)[] {
  const parent=node.parent;
  const prefix=parent.type==='TOMLTable' ? parent.resolvedKey : parent.type==='TOMLInlineTable' && parent.parent.type==='TOMLKeyValue' ? key(parent.parent) : [];
  return [...prefix,...getStaticTOMLValue(node.key)];
}
/** Edit the parsed value span, preserving unrelated keys, comments and formatting. */
export function enableGraphics(source:string):{text:string;changed:boolean} {
  const ast=parseForESLint(source).ast;
  const data=getStaticTOMLValue(ast) as Record<string,unknown>;
  const experimental=data.experimental;
  if(experimental!==undefined && (!experimental || typeof experimental!=='object' || Array.isArray(experimental)))throw new Error('HerdR experimental config must be a TOML table.');
  if((experimental as Record<string,unknown>|undefined)?.kitty_graphics===true)return {text:source,changed:false};
  let value:AST.TOMLContentNode|undefined, inline:AST.TOMLInlineTable|undefined, table:AST.TOMLTable|undefined;
  traverseNodes(ast,{enterNode(node){
    if(node.type==='TOMLKeyValue'){
      const path=key(node);
      if(path.length===2&&path[0]==='experimental'&&path[1]==='kitty_graphics')value=node.value;
      if(path.length===1&&path[0]==='experimental'&&node.value.type==='TOMLInlineTable')inline=node.value;
    }
    if(node.type==='TOMLTable'&&node.kind==='standard'&&node.resolvedKey.length===1&&node.resolvedKey[0]==='experimental')table=node;
  },leaveNode(){}});
  const newline=source.includes('\r\n')?'\r\n':'\n';let text:string;
  if(value)text=source.slice(0,value.range[0])+'true'+source.slice(value.range[1]);
  else if(inline){const end=inline.range[1]-1;text=source.slice(0,end)+(inline.body.length?', ':'')+'kitty_graphics = true'+source.slice(end);}
  else if(table){const end=source.indexOf('\n',table.key.range[1]);text=end<0?source+newline+'kitty_graphics = true'+newline:source.slice(0,end+1)+'kitty_graphics = true'+newline+source.slice(end+1);}
  else if(experimental)text='experimental.kitty_graphics = true'+newline+source;
  else text=source+(source&&!source.endsWith('\n')?newline:'')+newline+'[experimental]'+newline+'kitty_graphics = true'+newline;
  const checked=getStaticTOMLValue(parseForESLint(text).ast) as {experimental?:{kitty_graphics?:unknown}};
  if(checked.experimental?.kitty_graphics!==true)throw new Error('Could not enable HerdR graphics without changing the config structure.');
  return {text,changed:true};
}
export async function planHerdrSetup(env:NodeJS.ProcessEnv=process.env) {
  const configuredPath=herdrConfigPath(env);
  const path=await realpath(configuredPath).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return configuredPath;throw error;});
  let original='',exists=true;
  try{original=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;exists=false;}
  const edited=enableGraphics(original);
  return {path,original,exists,...edited};
}
export async function applyHerdrSetup(plan:Awaited<ReturnType<typeof planHerdrSetup>>) {
  if(!plan.changed)return undefined;
  let current:string|undefined;
  try{current=await readFile(plan.path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(current!==(plan.exists?plan.original:undefined))throw new Error('HerdR config changed while the prompt was open. Rerun to review the current file.');
  await mkdir(dirname(plan.path),{recursive:true});
  const mode=plan.exists?(await stat(plan.path)).mode&0o777:0o600;
  const backup=plan.exists?`${plan.path}.react-kitty-${randomUUID()}.bak`:undefined;
  const temp=`${plan.path}.react-kitty-${randomUUID()}.tmp`;
  try{
    if(backup)await writeFile(backup,plan.original,{flag:'wx',mode:0o600});
    await writeFile(temp,plan.text,{flag:'wx',mode});await chmod(temp,mode);await rename(temp,plan.path);
  }finally{await rm(temp,{force:true});}
  return backup;
}
interface SetupOptions {env?:NodeJS.ProcessEnv;signal?:AbortSignal;confirm?:(question:string)=>Promise<boolean>;write?:(message:string)=>void;reload?:()=>Promise<void>}
export async function offerHerdrSetup(error:unknown,options:SetupOptions={}):Promise<boolean> {
  if(!(error instanceof HerdrCapabilityError)||!['feature_disabled','cell_size_unavailable'].includes(error.code))throw error;
  const env=options.env??process.env,write=options.write??(text=>process.stderr.write(text));
  const plan=await planHerdrSetup(env);
  if(!plan.changed)throw new Error(`HerdR graphics is already enabled in ${plan.path}.\nThis running HerdR client cannot hot-reload graphics. Detach and reattach the client once; your server and panes keep running.`);
  const question=`Enable experimental.kitty_graphics in ${plan.path} and reload HerdR? [y/N] `;
  let accepted:boolean;
  if(options.confirm)accepted=await options.confirm(question);
  else{
    if(!process.stdin.isTTY)throw error;
    const rl=createInterface({input:process.stdin,output:process.stderr});
    try{accepted=/^(y|yes)$/i.test((await rl.question(question,{signal:options.signal})).trim());}finally{rl.close();}
  }
  if(!accepted)throw new Error('HerdR config unchanged. Graphics setup was declined.');
  const backup=await applyHerdrSetup(plan);
  write(`Enabled HerdR graphics in ${plan.path}.${backup?'\nBackup: '+backup:''}\n`);
  await (options.reload??(()=>reloadHerdrConfig(env)))();
  write('Reloaded HerdR config. Checking graphics availability…\n');
  return true;
}
