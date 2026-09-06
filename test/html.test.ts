import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveTarget } from '../src/target.js';
import { serveHtml } from '../src/html.js';

test('website normalization distinguishes URLs, local files and unsupported schemes',async()=> {
  for (const [input,url] of [['https://example.com/a?q=1#b','https://example.com/a?q=1#b'],['example.com/page.html','https://example.com/page.html'],['localhost:3000/a.html','http://localhost:3000/a.html'],['127.0.0.1:8080','http://127.0.0.1:8080/'],['[::1]:3000','http://[::1]:3000/']]) assert.deepEqual(await resolveTarget(input),{kind:'website',url});
  await assert.rejects(()=>resolveTarget('./absent.html'),/File not found/);
  await assert.rejects(()=>resolveTarget('javascript:alert(1)'),/Supported URL schemes/);
  await assert.rejects(()=>resolveTarget('ftp://example.com'),/Supported URL schemes/);
});
test('HTML server preserves content, relative paths, modules, ranges, HEAD and root isolation',async()=> {
  const root=await mkdtemp(join(tmpdir(),'starpane-html-'));
  let server:Awaited<ReturnType<typeof serveHtml>>|undefined;
  try {
    await mkdir(join(root,'pages')); await mkdir(join(root,'assets'));
    const document='<!doctype html><script type="module" src="../assets/main.mjs"></script>';
    const entry=join(root,'pages','hello world.htm'); await writeFile(entry,document);
    await writeFile(join(root,'assets','main.mjs'),'export const n=42;');
    await writeFile(join(root,'.env'),'secret');
    await symlink(tmpdir(),join(root,'escape'));
    assert.deepEqual(await resolveTarget(pathToFileURL(entry).href+'?q=1#anchor'),{kind:'html',file:entry,suffix:'?q=1#anchor'});
    server=await serveHtml(entry,root);
    assert.equal(await (await fetch(server.url)).text(),document);
    assert.ok(server.url.endsWith('/pages/hello%20world.htm'));
    const asset=new URL('../assets/main.mjs',server.url);
    const response=await fetch(asset); assert.match(response.headers.get('content-type')!,/javascript/);
    assert.equal(await response.text(),'export const n=42;');
    const head=await fetch(asset,{method:'HEAD'}); assert.equal(head.headers.get('content-length'),'18'); assert.equal(await head.text(),'');
    const range=await fetch(asset,{headers:{Range:'bytes=0-5'}}); assert.equal(range.status,206); assert.equal(await range.text(),'export');
    assert.equal((await fetch(asset,{headers:{Range:'bytes=999-'}})).status,416);
    assert.equal((await fetch(new URL('/.env',server.url))).status,403);
    assert.equal((await fetch(new URL('/escape/',server.url))).status,403);
    assert.equal((await fetch(new URL('/missing',server.url))).status,404);
    assert.equal((await fetch(asset,{method:'POST'})).status,405);
  } finally { await server?.close(); await rm(root,{recursive:true,force:true}); }
});
