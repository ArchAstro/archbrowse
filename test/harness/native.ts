/** Opt-in real Ghostty capture; fails clearly rather than substituting a fake terminal. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { waitFor } from './terminal.js';
const exec=promisify(execFile);
if(process.platform!=='darwin') throw new Error('Native capture currently supports macOS + Ghostty. The PTY harness is cross-platform.');
const dir=await mkdtemp(join(tmpdir(),'react-kitty-native-'));
const artifact=resolve('artifacts/native');
await mkdir(artifact,{recursive:true});
try {
  const swift=join(dir,'windows.swift');
  await writeFile(swift,`import CoreGraphics\nimport Foundation\nlet windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]\nlet list = windows.filter { ($0[kCGWindowOwnerName as String] as? String) == "Ghostty" }.map { ["id": $0[kCGWindowNumber as String]!, "pid": $0[kCGWindowOwnerPID as String]!] }\nlet data = try! JSONSerialization.data(withJSONObject:["permission":CGPreflightScreenCaptureAccess(), "windows":list])\nprint(String(data:data,encoding:.utf8)!)\n`);
  const inspect=async()=>JSON.parse((await exec('swift',[swift])).stdout) as {permission:boolean;windows:{id:number;pid:number}[]};
  const before=await inspect();
  if(!before.permission) throw new Error('Screen Recording access is disabled for this process. Enable it in macOS System Settings → Privacy & Security → Screen Recording, restart your terminal/Codex, and rerun npm run test:native. No native screenshot was claimed.');
  await exec('open',['-na','Ghostty','--stdout',join(artifact,'ghostty.log'),'--stderr',join(artifact,'ghostty-error.log'),'--args','--window-save-state=never','--title=React-Kitty-Verification','--window-width=100','--window-height=50','-e',process.execPath,resolve('dist/cli.js'),resolve('examples/App.tsx'),'--no-install']);
  let target:{id:number;pid:number}|undefined;
  await waitFor(async()=> { target=(await inspect()).windows.find(w=>!before.windows.some(b=>b.id===w.id)); return !!target; },'new Ghostty window',20000);
  // Native capture is for visual review; the automated PTY harness owns state readiness/assertions.
  await new Promise(r=>setTimeout(r,4000));
  await exec('screencapture',['-x','-l',String(target!.id),join(artifact,'ghostty.png')]);
  console.log(`Native Ghostty screenshot: ${join(artifact,'ghostty.png')}\nWindow left open for visual/input review; Ctrl+Q exits.`);
} finally { await rm(dir,{recursive:true,force:true}); }
