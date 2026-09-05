import { createServer } from 'node:http';
import { createReadStream, watchFile, unwatchFile, type Stats } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';

const mime: Record<string,string> = {
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.avif':'image/avif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2',
  '.ttf':'font/ttf', '.wasm':'application/wasm', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg',
  '.wav':'audio/wav', '.ogg':'audio/ogg', '.txt':'text/plain; charset=utf-8', '.pdf':'application/pdf',
};
const inside = (root:string, file:string) => file === root || file.startsWith(root + sep);

/** Serve the original document unchanged, including CSP and module scripts. */
export async function serveHtml(file:string, rootOption?:string, port=0) {
  const entry = await realpath(resolve(file));
  const root = await realpath(resolve(rootOption ?? dirname(entry)));
  if (!inside(root,entry)) throw new Error('HTML entry must be inside --root.');
  if (!(await stat(root)).isDirectory()) throw new Error('--root must be a directory.');
  if (!(await stat(entry)).isFile()) throw new Error(`Not a file: ${entry}`);
  const changed = new EventEmitter(), watched = new Map<string,(next:Stats,previous:Stats)=>void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function watch(path:string) {
    if (watched.has(path)) return;
    const listener=(next:Stats,previous:Stats)=> {
      if (next.mtimeMs === previous.mtimeMs && next.size === previous.size) return;
      clearTimeout(timer); timer=setTimeout(()=>changed.emit('change'),100);
    };
    watched.set(path,listener);
    watchFile(path,{interval:250,persistent:false},listener);
  }
  const server=createServer(async(req,res)=> {
    res.setHeader('Cache-Control','no-store');
    if (!['GET','HEAD'].includes(req.method ?? '')) { res.writeHead(405,{Allow:'GET, HEAD'}).end(); return; }
    try {
      const pathname=decodeURIComponent(new URL(req.url!,'http://localhost').pathname);
      if (pathname.includes('\0') || pathname.split('/').some(part=>part.startsWith('.'))) { res.writeHead(403).end(); return; }
      let path=resolve(root,'.'+pathname);
      if (!inside(root,path)) { res.writeHead(403).end(); return; }
      path=await realpath(path);
      if (!inside(root,path)) { res.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) {
        if (!pathname.endsWith('/')) { const url=new URL(req.url!,'http://localhost'); res.writeHead(301,{Location:url.pathname+'/'+url.search}).end(); return; }
        path=await realpath(resolve(path,'index.html'));
        if (!inside(root,path)) { res.writeHead(403).end(); return; }
      }
      const info=await stat(path);
      if (!info.isFile()) { res.writeHead(404).end(); return; }
      watch(path);
      res.setHeader('Content-Type',mime[extname(path).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Accept-Ranges','bytes');
      let start=0,end=info.size-1;
      if (req.headers.range) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (match && (match[1] || match[2])) {
          start=match[1] ? Number(match[1]) : Math.max(0,info.size-Number(match[2]));
          end=match[1] && match[2] ? Math.min(Number(match[2]),end) : end;
        }
        if (!match || (!match[1] && !match[2]) || start>end || start>=info.size) { res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end(); return; }
        res.statusCode=206; res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader('Content-Length',Math.max(0,end-start+1));
      if (req.method==='HEAD' || info.size===0) { res.end(); return; }
      const stream=createReadStream(path,{start,end});
      stream.on('error',()=>res.destroy()); res.on('close',()=>stream.destroy()); stream.pipe(res);
    } catch(error) {
      const code=(error as NodeJS.ErrnoException).code;
      res.writeHead(error instanceof URIError ? 400 : code==='EACCES' ? 403 : code==='ENOENT' || code==='ENOTDIR' ? 404 : 500).end();
    }
  });
  await new Promise<void>((yes,no)=> { server.once('error',no); server.listen(port,'127.0.0.1',yes); });
  const address=server.address();
  if (!address || typeof address==='string') throw new Error('Missing HTML server address');
  watch(entry);
  return {
    url:`http://127.0.0.1:${address.port}/`+relative(root,entry).split(sep).map(encodeURIComponent).join('/'),
    onChange(callback:()=>void) { changed.on('change',callback); },
    async close() {
      clearTimeout(timer); changed.removeAllListeners();
      for(const [path,listener] of watched) unwatchFile(path,listener);
      server.closeAllConnections();
      await new Promise<void>((yes,no)=>server.close(error=>error ? no(error) : yes()));
    },
  };
}
