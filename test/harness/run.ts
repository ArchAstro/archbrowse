import assert from 'node:assert/strict';
import { testHerdr } from './herdr.js';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { serveHtml } from '../../src/html.js';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { findChromium } from '../../src/browser.js';
import { writeReport } from './report.js';
import { Terminal, waitFor, samePixels } from './terminal.js';
const artifacts = resolve('artifacts', new Date().toISOString().replaceAll(':','-'));
await mkdir(artifacts,{recursive:true});
const profile = await mkdtemp(join(tmpdir(),'react-kitty-browser-'));
// Put generated entry next to the package so normal dependency resolution is exercised.
const fixtureDir = await mkdtemp(resolve('test/generated-'));
await cp('examples/html',join(fixtureDir,'html'),{recursive:true});
const source = await readFile('examples/App.tsx','utf8');
await writeFile(join(fixtureDir,'App.tsx'),source);
await writeFile(join(fixtureDir,'style.css'),await readFile('examples/style.css'));
const executable = await findChromium(); assert.ok(executable,'Installed Chromium is required by the harness (no download).');
const child = spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
let endpoint = '', browser:Browser | undefined, terminal:Terminal | undefined, page:Page | undefined;
const terminals: Terminal[] = [];
const cleanup: (()=>Promise<unknown>)[]=[];
let logs = '', report = '# React Kitty browser / PTY verification\n\n';
child.stderr.on('data',chunk => { logs+=chunk; endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(logs)?.[1] ?? endpoint; });
async function step(name:string, fn:()=>Promise<void>) { console.log(name); report += `1. ${name}\n`; await fn(); }
async function capture(name:string) {
  let reference: Buffer = Buffer.alloc(0), previous: Buffer | undefined;
  await waitFor(async()=> {
    reference = await page!.screenshot();
    const stable = previous && samePixels(previous,reference); previous=reference;
    return !!stable && terminal!.frames.some(frame=>samePixels(reference,frame));
  }, `pixel parity: ${name}`);
  const frame = terminal!.frames.find(frame=>samePixels(reference,frame))!;
  await writeFile(join(artifacts,`${name}-browser.png`),reference);
  await writeFile(join(artifacts,`${name}-terminal.png`),frame);
  report += `   - Browser and PTY PNG pixels match exactly: ${name}.\n`;
}
async function boot(target:string,mobile=false,pixel=true,ready='#counter') {
  const before = browser!.contexts().flatMap(c=>c.pages());
  terminal = new Terminal([target,'--cdp',endpoint,'--no-install','--fps','12',...(mobile ? ['--mobile'] : [])],pixel);
  terminals.push(terminal);
  await waitFor(()=> { page=browser!.contexts().flatMap(c=>c.pages()).find(p=>!before.includes(p)); return !!page; },'CLI page created');
  page!.setDefaultTimeout(10000);
  page!.on('console',message=> { if(message.type()==='error') report+=`   - Browser console: ${message.text()}\n`; });
  await page!.waitForSelector(ready);
  await waitFor(()=>terminal!.frames.length>0,'first Kitty frame');
}
async function click(selector:string,mobile=false) {
  const box = await page!.locator(selector).boundingBox(); assert.ok(box,selector);
  let x=box.x+box.width/2,y=box.y+box.height/2;
  if (mobile) { const scale=Math.min(terminal!.cols*8/390,terminal!.rows*16/844); x*=Math.floor(390*scale/8)*8/390; y*=Math.floor(844*scale/16)*16/844; }
  terminal!.mouse(0,x,y); terminal!.mouse(0,x,y,true);
}
try {
  await waitFor(()=>!!endpoint,'Chromium CDP ready'); browser=await chromium.connectOverCDP(endpoint);
  await step('Launch TSX in an actual PTY and compare Chromium pixels', async()=> { await boot(join(fixtureDir,'App.tsx')); await capture('01-desktop'); });
  await step('Click, keyboard activation, focus traversal and Unicode paste',async()=> {
    await click('#counter'); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1 launches');
    terminal!.write('\r'); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='2 launches');
    terminal!.write('\t'); terminal!.write('\x1b[200~Zoë 你好 😀\x1b[201~');
    await page!.waitForFunction(()=>document.querySelector<HTMLInputElement>('#name')?.value==='Zoë 你好 😀');
    const selectModifier = process.platform === 'darwin' ? 9 : 5;
    terminal!.write(`\x1b[97;${selectModifier}u\x1b[97;${selectModifier}:3u`); // OS-native select-all
    terminal!.write('\x1b[200~Ready\x1b[201~');
    await page!.waitForFunction(()=>document.querySelector<HTMLInputElement>('#name')?.value==='Ready');
    await capture('02-input');
    terminal!.write('\x1b[97;2;65u\x1b[97;2:3u\x1b[233;1u\x1b[233;1:3u\x1b[128512;1u\x1b[128512;1:3u');
    await page!.waitForFunction(()=>document.querySelector<HTMLInputElement>('#name')?.value==='ReadyAé😀');
  });
  await step('Checkbox, slider dragging, wheel scrolling and resize',async()=> {
    await click('#enabled'); await page!.waitForFunction(()=>!document.querySelector<HTMLInputElement>('#enabled')?.checked);
    const box=await page!.locator('#level').boundingBox(); assert.ok(box);
    terminal!.mouse(0,box.x+box.width*.35,box.y+box.height/2);
    terminal!.mouse(32,box.x+box.width*.85,box.y+box.height/2);
    terminal!.mouse(0,box.x+box.width*.85,box.y+box.height/2,true);
    await page!.waitForFunction(()=>Number(document.querySelector<HTMLInputElement>('#level')?.value)>75);
    terminal!.mouse(65,600,600); await page!.waitForFunction(()=>scrollY>0);
    await capture('03-controls');
    terminal!.resize(70,45); await page!.waitForFunction(()=>innerWidth===560 && innerHeight===720); await capture('04-resize');
  });
  await step('Agent file edits, compile-error overlay and recovery',async()=> {
    await writeFile(join(fixtureDir,'App.tsx'),source.replace('A real app.','Agent changed this.'));
    await page!.waitForFunction(()=>document.body.textContent?.includes('Agent changed this.'));
    await writeFile(join(fixtureDir,'App.tsx'),'export default function Broken( {');
    await page!.waitForSelector('#build-error'); await capture('05-build-error');
    await writeFile(join(fixtureDir,'App.tsx'),source);
    await page!.waitForSelector('#counter'); await page!.waitForSelector('#build-error',{state:'detached'});
    await capture('06-recovered');
    await writeFile(join(fixtureDir,'App.tsx'),`export default function App(){ throw new Error('Agent runtime failure'); }`);
    await page!.waitForSelector('#runtime-error'); await capture('06-runtime-error');
    await writeFile(join(fixtureDir,'App.tsx'),source); await page!.waitForSelector('#counter');
    await terminal!.close(); assert.equal(terminal!.ended,0);
  });
  await step('JSX entry, mobile viewport, touch tap and drag scrolling',async()=> {
    await writeFile(join(fixtureDir,'App.jsx'),source); await boot(join(fixtureDir,'App.jsx'),true);
    assert.deepEqual(await page!.evaluate(()=>[innerWidth,innerHeight,navigator.maxTouchPoints]),[390,844,1]);
    await click('#counter',true); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1 launches');
    await capture('07-mobile-tap');
    terminal!.mouse(0,180,700); terminal!.mouse(32,180,550); terminal!.mouse(32,180,300); terminal!.mouse(0,180,300,true);
    await page!.waitForFunction(()=>scrollY>0); await capture('08-mobile-scroll');
    await page!.locator('#name').scrollIntoViewIfNeeded();
    await click('#name',true); terminal!.write('\x1b[200~Mobile works\x1b[201~');
    await page!.waitForFunction(()=>document.querySelector<HTMLInputElement>('#name')?.value==='Mobile works');
    await capture('08-mobile-input'); await terminal!.close();
  });
  await step('JavaScript entry and cell-coordinate mouse fallback',async()=> {
    await writeFile(join(fixtureDir,'App.js'),source); await boot(join(fixtureDir,'App.js'),false,false);
    await click('#counter'); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1 launches'); await capture('09-js-cell-mouse');
    const url=page!.url();
    // A second CLI renders a regular URL served by the first session.
    const first=terminal; await boot(url);
    await capture('10-url'); await terminal!.close(); await first!.close();
  });
  await step('Local HTML loads CSS, modules and images; links, history and reload work',async()=> {
    await boot(join(fixtureDir,'html','index.html'));
    assert.equal(await page!.locator('h1 em').evaluate(e=>getComputedStyle(e).color),'rgb(215, 255, 137)');
    assert.equal(await page!.locator('img').evaluate((e:HTMLImageElement)=>e.naturalWidth),64);
    await click('#counter'); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1');
    await capture('11-html-assets');
    await click('#next'); await page!.waitForSelector('#destination'); await capture('12-html-link');
    terminal!.write('\x1b[1;3D'); await page!.waitForSelector('#counter');
    terminal!.write('\x1b[1;3C'); await page!.waitForSelector('#destination');
    terminal!.write('\x1b[1;3D'); await page!.waitForSelector('#counter');
    await click('#counter');
    terminal!.write('\x1b[15~'); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='0');
    await click('#name'); terminal!.write('\x1b[200~HTML User\x1b[201~'); await click('#submit');
    await page!.waitForFunction(()=>document.querySelector('#result')?.textContent==='Hello, HTML User.');
    await capture('13-html-form');
    terminal!.write('\x1b[1;3D'); await page!.waitForSelector('#counter');
    const opener=page!;
    const priorPages=new Set(browser!.contexts().flatMap(c=>c.pages()));
    await click('#popup');
    await waitFor(()=> { const next=browser!.contexts().flatMap(c=>c.pages()).find(p=>!priorPages.has(p)); if(next) page=next; return !!next; },'popup tab');
    page!.setDefaultTimeout(10000); await page!.waitForSelector('#destination'); await capture('14-popup');
    const popup=page!;
    terminal!.frames.length=0; terminal!.write('\x1b[9;5u\x1b[9;5:3u'); page=opener; await capture('15-tab-return');
    terminal!.frames.length=0; terminal!.write('\x1b[9;5u\x1b[9;5:3u'); page=popup; await capture('16-tab-switch');
    terminal!.frames.length=0; terminal!.write('\x17'); await waitFor(()=>popup.isClosed(),'popup closed'); page=opener;
    await capture('17-tab-close');
    await writeFile(join(fixtureDir,'html','assets','main.mjs'),`document.querySelector('#counter').textContent='Edited module';`);
    await page!.waitForFunction(()=>document.querySelector('#counter')?.textContent==='Edited module');
    await capture('18-html-live-edit'); await terminal!.close();
  });
  await step('file URLs and mobile HTML use the same input bridge',async()=> {
    await cp('examples/html',join(fixtureDir,'html'),{recursive:true});
    await boot(pathToFileURL(join(fixtureDir,'html','index.html')).href+'?mode=mobile#top',true);
    await click('#counter',true); await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1');
    await capture('19-html-mobile'); await terminal!.close();
  });
  await step('Bare localhost website follows HTTP redirects and renders without React',async()=> {
    const site=await serveHtml(join(fixtureDir,'html','index.html')); cleanup.push(()=>site.close());
    const redirect=createServer((_req,res)=>res.writeHead(302,{Location:site.url}).end());
    await new Promise<void>(r=>redirect.listen(0,'127.0.0.1',r));
    cleanup.push(()=>new Promise<void>(r=> { redirect.closeAllConnections(); redirect.close(()=>r()); }));
    const address=redirect.address(); assert.ok(address && typeof address!=='string');
    await boot(`localhost:${address.port}/redirect`);
    assert.equal(page!.url(),site.url); await click('#counter');
    await page!.waitForFunction(()=>document.querySelector('#count')?.textContent==='1');
    await capture('20-website-redirect'); await terminal!.close();
  });
  if(process.env.REACT_KITTY_WEB_SMOKE) await step('Live public HTTPS website smoke',async()=> {
    await boot(process.env.REACT_KITTY_WEB_SMOKE!,false,true,'h1');
    assert.ok((await page!.locator('h1').first().innerText()).length>0);
    await capture('21-public-website'); await terminal!.close();
  });
  if(process.env.REACT_KITTY_HERDR_TEST==='1') {
    await step('Real HerdR cold start: no pre-seeded dimensions, outer pixels, mouse and resize',()=>testHerdr(browser!,endpoint,artifacts));
    await step('Real HerdR existing client: reload cannot change startup graphics flag',()=>testHerdr(browser!,endpoint,artifacts,true));
    await step('Real HerdR setup: accept config update and reload',()=>testHerdr(browser!,endpoint,artifacts,false,'accept'));
    await step('Real HerdR setup: decline leaves config untouched',()=>testHerdr(browser!,endpoint,artifacts,false,'decline'));
    await step('Real HerdR small-link click at 21×48 cell pixels',()=>testHerdr(browser!,endpoint,artifacts,false,undefined,true));
    if(process.env.REACT_KITTY_WEB_SMOKE)await step('Live Example Domain Learn more link through HerdR',()=>testHerdr(browser!,endpoint,artifacts,false,undefined,'live'));
  }
  await step('Attached Chromium remains alive after CLI cleanup',async()=> { assert.equal(browser!.isConnected(),true); assert.equal(browser!.contexts().length,1); });
  report += '\nPASS — all scenarios passed.\n';
  console.log(`PASS: ${artifacts}`);
} catch(error) {
  report += `\nFAIL: ${String(error)}\n`;
  if(page && !page.isClosed()) { await page.screenshot({path:join(artifacts,'failure-browser.png')}).catch(()=>{}); await writeFile(join(artifacts,'failure.html'),await page.content().catch(()=>'')); }
  if(terminal?.frames.length) await writeFile(join(artifacts,'failure-terminal.png'),terminal.frames.at(-1)!);
  throw error;
} finally {
  await writeFile(join(artifacts,'report.md'),report);
  await writeReport(artifacts,report);
  if(terminal) { await writeFile(join(artifacts,'terminal.log'),terminal.transcript); }
  await Promise.allSettled(terminals.map(t=>t.close()));
  await browser?.close(); child.kill('SIGTERM');
  await Promise.allSettled(cleanup.map(fn=>fn()));
  await rm(fixtureDir,{recursive:true,force:true});
  await new Promise(r=>setTimeout(r,300)); await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
