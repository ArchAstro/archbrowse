import type { Page } from 'playwright-core';
import { PageView } from '../page-view.js';
import { resolveTarget } from '../target.js';
import { AgentError, type AgentRequest } from './protocol.js';
import { SnapshotRefs } from './snapshot.js';

export class AgentController {
  private refs=new SnapshotRefs();
  private generation=-1;
  private tabs=new WeakMap<Page,string>();private nextTab=0;
  constructor(private name:string,private view:PageView){}
  private tabId(page:Page){let id=this.tabs.get(page);if(!id){id=`t${++this.nextTab}`;this.tabs.set(page,id);}return id;}
  async execute(r:AgentRequest):Promise<unknown> {
    if(this.generation!==this.view.generation){this.refs.clear();this.generation=this.view.generation;}
    const page=this.view.page, args=r.args,timeout=r.timeout??10000;
    if(page.isClosed())throw new AgentError('page_closed','The active page closed. Attach again after switching tabs.');
    const arity=(min:number,max=min)=>{if(args.length<min||args.length>max)throw new AgentError('invalid_arguments',`${r.command} expects ${min===max?min:`${min}–${max}`} arguments.`);};
    const target=async(index=0)=>{if(!args[index])throw new AgentError('invalid_arguments','Provide a snapshot ref or selector.');return this.refs.target(page,args[index]);};
    const done=()=>({url:this.view.page.url()});
    switch(r.command){
      case 'attach':arity(0);return {session:this.name,url:page.url(),title:await page.title(),tab:this.tabId(page)};
      case 'snapshot':arity(0);return this.refs.snapshot(page,r.interactive);
      case 'read':arity(0);return page.locator('body').innerText({timeout});
      case 'click':case 'dblclick':case 'hover':case 'focus':case 'check':case 'uncheck':{
        arity(1);const element=await target();
        if(r.command==='focus')await element.focus({timeout});
        else await element[r.command]({timeout});
        return done();
      }
      case 'fill':case 'type':{arity(2);const element=await target();await element[r.command](args[1],{timeout});return done();}
      case 'select':arity(2,100);await (await target()).selectOption(args.slice(1),{timeout});return done();
      case 'press':arity(1);await page.keyboard.press(args[0]);return done();
      case 'scroll':{
        arity(1,2);if(!['up','down','left','right'].includes(args[0]))throw new AgentError('invalid_arguments','Scroll direction must be up, down, left or right.');
        const amount=Number(args[1]??500);if(!Number.isFinite(amount)||amount<0)throw new AgentError('invalid_arguments','Scroll distance must be a positive number.');
        await page.mouse.wheel(args[0]==='left'?-amount:args[0]==='right'?amount:0,args[0]==='up'?-amount:args[0]==='down'?amount:0);return done();
      }
      case 'get':{
        if(args[0]==='url'){arity(1);return page.url();}
        if(args[0]==='title'){arity(1);return page.title();}
        arity(args[0]==='attr'?3:2);const element=await target(1);
        if(args[0]==='text')return element.innerText();
        if(args[0]==='html')return element.innerHTML();
        if(args[0]==='value')return element.inputValue();
        if(args[0]==='attr')return element.getAttribute(args[2]);
        throw new AgentError('invalid_arguments','get supports url, title, text, html, value and attr.');
      }
      case 'wait':{
        const conditions=Number(!!args.length)+Number(r.text!==undefined)+Number(r.url!==undefined);
        if(conditions!==1)throw new AgentError('invalid_arguments','Use wait SELECTOR, wait --text TEXT, or wait --url GLOB.');
        if(r.text!==undefined)await page.getByText(r.text).first().waitFor({state:'visible',timeout});
        else if(r.url!==undefined)await page.waitForURL(r.url,{waitUntil:'commit',timeout});
        else {arity(1);const element=await target();if('waitFor' in element)await element.waitFor({state:'visible',timeout});else await element.waitForElementState('visible',{timeout});}
        return done();
      }
      case 'screenshot':arity(0);return {imageBase64:(await page.screenshot({fullPage:r.full,timeout})).toString('base64')};
      case 'open':{
        arity(1);let url:string;
        if(/^(\/|\.|#|\?)/.test(args[0]))url=new URL(args[0],page.url()).href;
        else {const target=await resolveTarget(args[0]);if(target.kind!=='website')throw new AgentError('invalid_arguments','Agent open accepts web URLs. Local entry files are selected when launching the terminal session.');url=target.url;}
        if(!/^https?:\/\//i.test(url))throw new AgentError('invalid_arguments','Agent open requires an HTTP(S) URL.');
        await page.goto(url,{waitUntil:'domcontentloaded',timeout});this.refs.clear();return done();
      }
      case 'back':case 'forward':case 'reload':{
        arity(0);if(r.command==='back')await page.goBack({waitUntil:'commit',timeout});
        else if(r.command==='forward')await page.goForward({waitUntil:'commit',timeout});
        else await page.reload({waitUntil:'domcontentloaded',timeout});
        this.refs.clear();return done();
      }
      case 'tab':{
        arity(0,2);const pages=page.context().pages().filter(p=>!p.isClosed());
        if(!args.length||args[0]==='list'){arity(0,1);return Promise.all(pages.map(async p=>({id:this.tabId(p),active:p===page,url:p.url(),title:await p.title()})));}
        if(args[0]==='new'){
          const next=await page.context().newPage();await this.view.activate(next);
          if(args[1])await this.execute({...r,command:'open',args:[args[1]]});this.refs.clear();return {id:this.tabId(next),url:next.url()};
        }
        const id=args[0]==='close'?args[1]??this.tabId(page):args[0];
        const selected=pages.find(p=>this.tabId(p)===id);if(!selected)throw new AgentError('unknown_tab',`Unknown tab ${id}. Run tab list.`);
        if(args[0]==='close'){await selected.close();return {closed:id};}
        arity(1);await this.view.activate(selected);this.refs.clear();return done();
      }
      case 'eval':{
        arity(1);let timer:ReturnType<typeof setTimeout>|undefined;
        try {return await Promise.race([page.evaluate(args[0]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AgentError('command_timeout','Page evaluation timed out.')),timeout);})]);}
        finally{clearTimeout(timer);}
      }
      default:throw new AgentError('invalid_command',`Unknown command ${r.command}.`);
    }
  }
  close(){this.refs.clear();}
}
