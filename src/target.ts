import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveReact } from './server.js';
import { serveHtml } from './html.js';

export type Target = { kind:'website'; url:string } | { kind:'html'|'react'; file:string; suffix?:string };
export async function resolveTarget(input:string):Promise<Target> {
  if (/^https?:\/\//i.test(input)) return {kind:'website',url:new URL(input).href};
  let file=input, suffix='';
  if (/^file:/i.test(input)) { const url=new URL(input); file=fileURLToPath(url); suffix=url.search+url.hash; }
  const info=await stat(file).catch((error:NodeJS.ErrnoException)=> { if (error.code==='ENOENT' || error.code==='ENOTDIR') return undefined; throw error; });
  if (!info && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?([/?#]|$)/i.test(input)) return {kind:'website',url:new URL('http://'+input).href};
  const bareHost=input.split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (!info && !/\.(html?|[jt]sx?)$/i.test(bareHost) && /^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#]|$)/.test(input)) return {kind:'website',url:new URL('https://'+input).href};
  if (info?.isFile() || /\.(html?|[jt]sx?)$/i.test(file)) {
    if (!info?.isFile()) throw new Error(`File not found: ${file}`);
    const extension=extname(file).toLowerCase();
    if (/^\.html?$/.test(extension)) return {kind:'html',file:resolve(file),suffix};
    if (/^\.[jt]sx?$/.test(extension)) return {kind:'react',file:resolve(file)};
    throw new Error(`Unsupported file type: ${extension}. Use HTML, HTM, TSX, JSX, JS or TS.`);
  }
  if (info?.isDirectory()) throw new Error(`Provide an entry file, for example ${file}/index.html.`);
  if (input.startsWith('//')) return {kind:'website',url:new URL('https:'+input).href};
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) throw new Error('Supported URL schemes are http:, https: and local file:.');
  throw new Error(`Cannot resolve ${input}. Provide an HTML/React file or an HTTP(S) URL.`);
}
export async function openTarget(input:string, root?:string, port=0) {
  const target=await resolveTarget(input);
  if (root && target.kind!=='html') throw new Error('--root applies only to local HTML files.');
  if(target.kind==='website') return {url:target.url,close:async()=>{},onChange:(_callback:()=>void)=>{}};
  if(target.kind==='html') { const server=await serveHtml(target.file,root,port); return {...server,url:server.url+(target.suffix ?? '')}; }
  return {...await serveReact(target.file,port),onChange:(_callback:()=>void)=>{}};
}
