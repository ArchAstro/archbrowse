import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// node-pty 1.1.0 retains ConoutConnection worker threads with useConptyDll.
// Isolate the driver lifetime; completion is acknowledged only after all
// assertions, browser/HerdR shutdown and temporary-directory cleanup succeed.
const worker=fork(fileURLToPath(new URL('./platform.ts',import.meta.url)),process.argv.slice(2),{
  stdio:['inherit','inherit','inherit','ipc'],
});
await new Promise<void>((resolve,reject)=>{
  let complete=false,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;worker.kill('SIGTERM');},360_000);
  worker.once('error',error=>{clearTimeout(timer);reject(error);});
  worker.on('message',message=>{
    if((message as {type?:string})?.type==='platform-complete') {
      complete=true;worker.kill('SIGTERM');
    }
  });
  worker.once('exit',(code,signal)=>{
    clearTimeout(timer);
    if(complete&&!timedOut)resolve();
    else reject(new Error(timedOut?'Platform smoke exceeded six minutes':`Platform worker exited before successful cleanup (${code??signal})`));
  });
});
