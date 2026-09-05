import type { BrowserContext, CDPSession, Page } from 'playwright-core';
import type { Input } from './input.js';
import { Interaction } from './interaction.js';
import type { Geometry } from './kitty.js';

/** One displayed tab, using the same renderer and input bridge for every source. */
export class PageView {
  page!:Page;
  frame:Buffer | undefined;
  private cdp:CDPSession | undefined;
  private interaction:Interaction | undefined;
  private revision=0;
  private disposed=false;
  constructor(private context:BrowserContext, private geometry:()=>Geometry, private pixel:()=>boolean, private mobile:boolean,
    private queue:(fn:()=>Promise<unknown>)=>void, private stop:()=>void, private size:()=>{width:number;height:number}) {}

  async start(urls?:string[], activeTab=0) {
    const first=this.context.pages()[0] ?? await this.context.newPage();
    await this.activate(first);
    if(urls?.length) {
      for(let index=0;index<urls.length;index++) {
        const page=index===0 ? first : await this.context.newPage();
        await page.goto(urls[index],{waitUntil:'domcontentloaded',timeout:30000});
      }
      // Reuse the stream when the restored active tab is already selected.
      const active=this.context.pages()[activeTab] ?? first;
      if(active!==this.page)await this.activate(active);
    }
    this.context.on('page',this.newPage);
  }
  private newPage = (page:Page) => {
    this.queue(async()=> { if(!page.isClosed() && page!==this.page) await this.activate(page); });
  };
  async activate(page:Page) {
    if(page.isClosed() || this.disposed) return;
    if(this.interaction && !this.page.isClosed()) await this.interaction.dispatch({type:'focus',focused:false});
    const revision=++this.revision;
    if(this.cdp) { await this.cdp.send('Page.stopScreencast').catch(()=>{}); await this.cdp.detach().catch(()=>{}); }
    this.frame=undefined; this.page=page;
    page.setDefaultTimeout(5000);
    // Install once even when switching back to this page.
    if(!this.known.has(page)) {
      this.known.add(page);
      page.on('dialog',dialog=> { void dialog.dismiss().catch(()=>{}); });
      page.on('close',()=>this.queue(async()=> {
        if(this.page!==page || this.disposed) return;
        const next=this.context.pages().filter(p=>!p.isClosed()).at(-1);
        if(next) await this.activate(next); else this.stop();
      }));
    }
    await page.setViewportSize(this.size());
    await page.bringToFront();
    const cdp=this.cdp=await this.context.newCDPSession(page);
    this.interaction=new Interaction(page,cdp,this.geometry,this.pixel,this.mobile);
    cdp.on('Page.screencastFrame',event=> {
      if(revision===this.revision && !this.disposed) this.frame=Buffer.from(event.data,'base64');
      void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
    });
    await cdp.send('Page.startScreencast',{format:'png',everyNthFrame:1});
  }
  get generation(){return this.revision;}
  private known=new WeakSet<Page>();
  async resize() {
    const size=this.size(), old=this.page.viewportSize();
    if(old?.width!==size.width || old?.height!==size.height) {
      await this.page.setViewportSize(size);
      // A static page may not emit another screencast frame after metrics change.
      // Capture the resized surface once; subsequent paints still use the stream.
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const frame=await Promise.race([
          this.cdp!.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),
          new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Chromium did not capture the resized viewport.')),5000);}),
        ]);
        this.frame=Buffer.from(frame.data,'base64');
      }finally{clearTimeout(timer);}
    }
  }
  async dispatch(event:Input) {
    if(event.type==='key') {
      const key=event.key.toLowerCase(), ctrl=event.modifiers.includes('Control'), meta=event.modifiers.includes('Meta'), alt=event.modifiers.includes('Alt');
      const action = alt && key==='arrowleft' ? 'back' : alt && key==='arrowright' ? 'forward' : (ctrl || meta) && key==='r' || key==='f5' ? 'reload' : ctrl && key==='tab' ? 'tab' : (ctrl || meta) && key==='w' ? 'close' : undefined;
      if(action) {
        if(event.event==='release') return;
        await this.interaction?.dispatch({type:'focus',focused:false});
        // Back/forward-cache restores can display a document without another
        // DOMContentLoaded event. Commit is the history navigation boundary.
        if(action==='back') await this.page.goBack({waitUntil:'commit',timeout:15000});
        if(action==='forward') await this.page.goForward({waitUntil:'commit',timeout:15000});
        if(action==='reload') await this.page.reload({waitUntil:'domcontentloaded',timeout:15000});
        if(action==='close') await this.page.close();
        if(action==='tab') {
          const pages=this.context.pages().filter(p=>!p.isClosed()), index=pages.indexOf(this.page);
          const next=pages[(index+(event.modifiers.includes('Shift') ? -1 : 1)+pages.length)%pages.length];
          if(next && next!==this.page) await this.activate(next);
        }
        return;
      }
    }
    if(!this.page.isClosed()) await this.interaction?.dispatch(event);
  }
  async reloadLocal(origin:string) {
    for(const page of this.context.pages()) if(!page.isClosed() && new URL(page.url()).origin===origin) await page.reload({waitUntil:'domcontentloaded',timeout:15000});
  }
  dispose() { this.disposed=true; this.context.off('page',this.newPage); }
}
