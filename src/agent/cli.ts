import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { sendAgent } from './ipc.js';
import type { AgentRequest } from './protocol.js';
export async function runAgent(name:string,request:AgentRequest,json=false) {
  let path:string|undefined;
  if(request.command==='screenshot'){
    if(request.args.length!==1)throw new Error('screenshot expects an output PNG path.');
    path=resolve(request.args[0]);request={...request,args:[]};
  }
  let result=await sendAgent(name,request);
  if(path){
    const image=result as {imageBase64?:string};if(!image?.imageBase64)throw new Error('Session returned no screenshot.');
    await writeFile(path,Buffer.from(image.imageBase64,'base64'));result={path};
  }
  if(json)process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  else if(typeof result==='string')process.stdout.write(result+'\n');
  else if(request.command==='snapshot'){
    const snapshot=result as {url:string;title:string;tree:string};process.stdout.write(`Page: ${snapshot.title}\nURL: ${snapshot.url}\n\n${snapshot.tree}\n`);
  }else process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
