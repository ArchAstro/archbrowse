import { serveAgent } from './agent/ipc.js';
import { AgentController } from './agent/controller.js';
import { offerHerdrSetup } from './herdr-setup.js';
import { HerdrGraphics, HerdrCapabilityError } from './herdr.js';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireSession, type SessionRecord } from './sessions.js';
import type { Browser, BrowserContext } from 'playwright-core';
import { openBrowser, openPersistentBrowser } from './browser.js';
import { openTarget, resolveTarget } from './target.js';
import { InputParser, type Input } from './input.js';
import { encodeFrame, enterTerminal, leaveTerminal, geometryQuery, graphicsQuery, viewport, displayGeometry, type Geometry } from './kitty.js';
import { PageView } from './page-view.js';

export interface SessionOptions { target?: string; name?:string; chromium?: string; cdp?: string; install?: boolean; fps: number; mobile?: { width:number; height:number }; cellWidth:number; cellHeight:number; force?:boolean; root?:string }
export async function runSession(options: SessionOptions) {
  const stdin = process.stdin, stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Interactive mode needs a TTY and a Kitty graphics terminal.');
  if (process.env.TMUX && !options.force) throw new Error('Run directly in a Kitty graphics terminal (tmux passthrough is not supported).');
  let browser: Browser | undefined, server: Awaited<ReturnType<typeof openTarget>> | undefined;
  let named: Awaited<ReturnType<typeof acquireSession>> | undefined;
  let saved: SessionRecord | undefined;
  let agentServer:Awaited<ReturnType<typeof serveAgent>>|undefined;
  let agent:AgentController|undefined;
  let ready = false;
  let ownContext: BrowserContext | undefined;
  let entered = false, stopped = false, pixel = false, graphics: boolean | undefined;
  let failure: unknown, queue = Promise.resolve();
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  let view: PageView | undefined;
  let herdr: HerdrGraphics | undefined;
  let geometry: Geometry = { columns:stdout.columns || 80, rows:stdout.rows || 24, cellWidth:options.cellWidth, cellHeight:options.cellHeight };
  let resizeRevision = 0;
  const outputAbort = new AbortController();
  const stop = () => { stopped = true; outputAbort.abort(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  function serialize<T>(fn:()=>Promise<T>):Promise<T> {
    const result=queue.then(()=>{if(stopped)throw new Error('Session is closing.');return fn();});
    queue=result.then(()=>{},()=>{});return result;
  }
  const enqueue = (fn: () => Promise<unknown>) => { void serialize(fn).catch(error=>{failure=error;stop();}); };
  const parser = new InputParser((event: Input) => {
    if (event.type === 'graphics') { graphics = event.ok; return; }
    if (event.type === 'mode' && event.mode === 1016 && (event.status === 1 || event.status === 2)) { pixel = true; stdout.write('\x1b[?1016h'); return; }
    if (event.type === 'size' && event.width > 0 && event.height > 0) {
      if (event.kind === 6) geometry = { ...geometry, cellWidth:event.width, cellHeight:event.height };
      if (event.kind === 4) geometry = { ...geometry, cellWidth:event.width / geometry.columns, cellHeight:event.height / geometry.rows };
      resizeRevision++; return;
    }
    if (event.type === 'key' && event.key.toLowerCase() === 'q' && event.modifiers.includes('Control')) { stop(); return; }
    if (view) enqueue(() => view!.dispatch(event));
  });
  const onData = (data: Buffer) => { parser.push(data); clearTimeout(escapeTimer); escapeTimer = setTimeout(() => parser.flushEscape(), 35); };
  const onResize = () => { geometry = { ...geometry, columns:stdout.columns, rows:stdout.rows }; resizeRevision++; if(!herdr) stdout.write(geometryQuery); };
  async function write(frame: string) {
    if (!stdout.write(frame)) {
      try { await once(stdout, 'drain', { signal:outputAbort.signal }); }
      catch(error) { if (!stopped) throw error; }
    }
  }
  try {
    // HerdR can finish laying out its pane while browser startup/navigation is
    // awaiting I/O. Retain those resize events before the first frame is sent.
    stdout.on('resize', onResize);
    const openHerdr=()=>HerdrGraphics.open(error=>{failure=error;stop();},process.env,{signal:outputAbort.signal,onWaiting:()=>process.stderr.write('Waiting for HerdR to discover host pixel dimensions…\n')});
    try { herdr=await openHerdr(); }
    catch(error) {
      await offerHerdrSetup(error,{signal:outputAbort.signal});
      try {herdr=await openHerdr();}catch(retryError){
        if(retryError instanceof HerdrCapabilityError && retryError.code==='cell_size_unavailable')throw new Error('HerdR config was updated and reloaded. This running client cannot hot-reload graphics; detach and reattach it once. Your server and panes keep running.');
        throw retryError;
      }
    }
    if(herdr){geometry=await herdr.geometry(geometry);pixel=herdr.pixelMouse;}
    if(options.name && options.cdp) throw new Error('--session cannot be combined with --cdp; named sessions own their browser profile.');
    named=options.name ? await acquireSession(options.name) : undefined;
    const previous=await named?.read();
    const resuming=!options.target;
    const input=options.target ?? previous?.target;
    if(!input) throw new Error('Provide a target when creating a session.');
    options={...options, mobile:options.mobile ?? previous?.mobile, root:options.root ?? (resuming ? previous?.root : undefined)};
    const source=await resolveTarget(input);
    const canonical=source.kind==='website' ? source.url : source.kind==='html' ? pathToFileURL(source.file).href+(source.suffix ?? '') : source.file;
    server = await openTarget(canonical, options.root, named ? previous?.port : undefined);
    const target = server.url;
    const browserOptions={executable:options.chromium,cdp:options.cdp,install:options.install,log:(message:string)=>process.stderr.write(message+'\n')};
    const contextOptions={ viewport:viewport(geometry, options.mobile), deviceScaleFactor:1, isMobile:!!options.mobile, hasTouch:!!options.mobile, ...(options.mobile ? { userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) };
    if(named) {
      ownContext=await openPersistentBrowser(named.profile,contextOptions,browserOptions);
      await named.restoreCookies(ownContext);
    } else {
      browser=await openBrowser(browserOptions);
      ownContext=await browser.newContext(contextOptions);
    }
    const context=ownContext;
    context.on('close',stop);
    browser?.on('disconnected', stop);
    view = new PageView(context, () => displayGeometry(geometry, options.mobile), () => pixel, !!options.mobile, enqueue, stop, () => viewport(geometry, options.mobile));
    const tabs=resuming && previous?.tabs.length ? previous.tabs : [target];
    await view.start(tabs,resuming ? previous?.activeTab : 0);
    server.onChange(() => enqueue(() => view!.reloadLocal(new URL(target).origin)));
    if(named) {
      saved={version:1,name:named.name,createdAt:previous?.createdAt ?? new Date().toISOString(),updatedAt:new Date().toISOString(),target:canonical,root:options.root ? resolve(options.root) : undefined,port:source.kind!=='website' ? Number(new URL(target).port) : previous?.port,mobile:options.mobile,tabs,activeTab:Math.max(0,context.pages().indexOf(view.page))};
      await named.save(saved);
    }
    ready=true;
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
    entered = true; await write(enterTerminal + (herdr ? (pixel ? '\x1b[?1016h' : '') : graphicsQuery + geometryQuery));
    // Query responses share stdin with user events. A bounded probe avoids hanging old terminals.
    for (let n = 0; n < 20 && !herdr && graphics === undefined && !stopped; n++) await delay(25);
    if (!herdr && graphics !== true && !options.force) throw new Error('Terminal did not confirm Kitty graphics support. Use Kitty/Ghostty, or --force for a compatible terminal that omits query responses.');
    if(named){
      agent=new AgentController(named.name,view);
      agentServer=await serveAgent(named.name,request=>request.command==='wait'?agent!.execute(request):serialize(()=>agent!.execute(request)));
    }
    let lastHash = '', id: 101 | 102 = 101, appliedResize = -1;
    while (!stopped) {
      const started = performance.now();
      await queue;
      if (stopped) break;
      if (appliedResize !== resizeRevision) { appliedResize = resizeRevision; if(herdr){geometry=await herdr.geometry(geometry);if(pixel!==herdr.pixelMouse){pixel=herdr.pixelMouse;await write(pixel?'\x1b[?1016h':'\x1b[?1016l');}} await serialize(()=>view!.resize()); lastHash = ''; }
      const png = view.frame;
      if (!png) { await delay(20); continue; }
      const hash = createHash('sha256').update(png).digest('hex');
      if (hash !== lastHash) { const placement=displayGeometry(geometry,options.mobile); if(herdr) await herdr.frame(png,placement.columns,placement.rows); else await write(encodeFrame(png,placement.columns,placement.rows,id)); id = id === 101 ? 102 : 101; lastHash = hash; }
      await delay(Math.max(1, 1000 / options.fps - (performance.now() - started)));
    }
    await queue;
    if (failure) throw failure;
  } finally {
    stopped = true;
    let cleanupError:unknown;
    try {await agentServer?.close();}catch(error){cleanupError=error;}
    agent?.close();
    view?.dispose();
    herdr?.close();
    clearTimeout(escapeTimer);
    stdin.off('data', onData); stdout.off('resize', onResize);
    process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('SIGHUP', stop);
    if (entered) { stdout.write(leaveTerminal); stdin.setRawMode(false); stdin.pause(); }
    // Save before closing Chromium so session cookies and the active URLs are available.
    // Closing a persistent context flushes localStorage / IndexedDB to its profile.
    try {
      if(named && saved && ready && ownContext) {
        const pages=ownContext.pages().filter(page=>!page.isClosed() && /^https?:\/\//i.test(page.url()));
        await named.save({...saved,updatedAt:new Date().toISOString(),tabs:pages.map(page=>page.url()),activeTab:Math.max(0,pages.indexOf(view!.page))});
        await named.saveCookies(ownContext);
      }
    } catch(error) { cleanupError=error; }
    try { await ownContext?.close(); } catch(error) { cleanupError ??= error; }
    try { await browser?.close(); } catch(error) { cleanupError ??= error; }
    try { await server?.close(); } catch(error) { cleanupError ??= error; }
    try { await named?.release(); } catch(error) { cleanupError ??= error; }
    if(cleanupError) throw cleanupError;
  }
}
