import { randomBytes } from 'node:crypto';
import { parse, stringify } from 'yaml';
import type { ElementHandle, Page } from 'playwright-core';
import { AgentError } from './protocol.js';
const interactive=new Set(['button','link','textbox','searchbox','checkbox','radio','combobox','listbox','option','slider','spinbutton','switch','tab','menuitem','menuitemcheckbox','menuitemradio','treeitem']);
type Role=Parameters<Page['getByRole']>[0];
export class SnapshotRefs {
  private refs=new Map<string,ElementHandle>();
  private page:Page|undefined;
  private counter=0;
  private documentRevision=0;
  private prefix=randomBytes(2).toString('hex');
  private watched=new WeakSet<Page>();
  clear(){for(const handle of this.refs.values())void handle.dispose().catch(()=>{});this.refs.clear();}
  async snapshot(page:Page,onlyInteractive=false) {
    this.clear();this.page=page;
    if(!this.watched.has(page)){this.watched.add(page);page.on('framenavigated',frame=>{if(frame===page.mainFrame()){this.documentRevision++;this.clear();}});page.on('close',()=>this.clear());}
    const revision=this.documentRevision;
    const tree=parse(await page.locator('body').ariaSnapshot({timeout:5000})) as unknown;
    const occurrences=new Map<string,number>(),matches=new Map<string,ElementHandle[]>(),rows:string[]=[],refs:{ref:string;role:string;name:string}[]=[];
    const annotate=async(description:string)=>{
      const match=/^([a-z]+)(?: ("(?:[^"\\]|\\.)*"))?(.*)$/.exec(description);
      if(!match||!interactive.has(match[1]))return description;
      const [,role,quoted,tail]=match,name=quoted?JSON.parse(quoted) as string:'';
      const key=JSON.stringify([role,name]),index=occurrences.get(key)??0;occurrences.set(key,index+1);
      if(!matches.has(key))matches.set(key,await page.getByRole(role as Role,{name,exact:true}).elementHandles());
      const handle=matches.get(key)![index];
      if(!handle)throw new AgentError('page_changed','The page changed during snapshot. Take another snapshot.');
      const ref=`@e${this.prefix}_${++this.counter}`;this.refs.set(ref,handle);refs.push({ref,role,name});
      const result=`${role}${quoted?' '+quoted:''} [ref=${ref}]${tail}`;rows.push(result);return result;
    };
    const walk=async(node:unknown):Promise<unknown>=>{
      if(Array.isArray(node)){const result=[];for(const item of node)result.push(typeof item==='string'?await annotate(item):await walk(item));return result;}
      if(node&&typeof node==='object'){
        const result:Record<string,unknown>={};
        for(const [description,children] of Object.entries(node))result[await annotate(description)]=children&&typeof children==='object'?await walk(children):children;
        return result;
      }
      return node;
    };
    try {
      const annotated=await walk(tree);
      const title=await page.title();
      if(revision!==this.documentRevision)throw new AgentError('page_changed','The page navigated during snapshot. Take another snapshot.');
      const retained=new Set(this.refs.values());for(const handles of matches.values())for(const handle of handles)if(!retained.has(handle))await handle.dispose();
      return {url:page.url(),title,tree:stringify(onlyInteractive?rows:annotated,{lineWidth:0}).trimEnd(),refs};
    }catch(error){this.clear();for(const handles of matches.values())for(const handle of handles)void handle.dispose().catch(()=>{});throw error;}
  }
  async target(page:Page,selector:string) {
    if(!selector.startsWith('@'))return page.locator(selector);
    const handle=this.refs.get(selector);
    if(!handle||page!==this.page)throw new AgentError('stale_ref',`Unknown or stale ref ${selector}. Run snapshot again.`);
    const connected=await handle.evaluate(element=>element.isConnected).catch(()=>false);
    if(!connected)throw new AgentError('stale_ref',`Ref ${selector} is no longer attached. Run snapshot again.`);
    return handle;
  }
}
