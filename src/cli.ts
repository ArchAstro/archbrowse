#!/usr/bin/env node
import { runAgent } from './agent/cli.js';
import { agentCommands, AgentError } from './agent/protocol.js';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runSession } from './session.js';
import { listSessions, deleteSession } from './sessions.js';
import { installBrowser } from './browser.js';
const help = `starpane — React and websites in your terminal

  starpane ./App.tsx             Live React entry (default export or App)
  starpane ./app.jsx             JSX / JS / TS also accepted
  starpane ./index.html         Local HTML with relative assets and live reload
  starpane https://example.com   Any HTTP(S) website
  starpane example.com           Bare domains default to HTTPS
  starpane localhost:3000        Local dev server
  starpane ./App.tsx --mobile    390 × 844 CSS pixels + touch emulation

  starpane example.com --session work  Create/reuse a saved browser profile
  starpane --session work              Reopen saved pages
  starpane sessions list               List named sessions
  starpane sessions delete work        Delete an inactive profile

  starpane attach work                 Inspect a live session
  starpane --session work snapshot -i  Discover interactive refs
  starpane --session work click @REF   Drive the visible page
  starpane --session work fill @REF TEXT
  starpane --session work screenshot page.png

  Agent commands: attach, snapshot, read, click, dblclick, hover, focus,
    fill, type, press, check, uncheck, select, scroll, get, wait, screenshot,
    open, back, forward, reload, tab, eval
  -i, --interactive   Interactive snapshot nodes only
  --full              Full-page screenshot
  --timeout MS        Agent command timeout (default 10000, max 30000)
  --text TEXT         Wait for visible text
  --url GLOB          Wait for URL

  --session NAME      Persist cookies, site storage and open URLs
  --json              Machine-readable agent and session results
  --root PATH         HTML document root (default: entry file directory)
  --chromium PATH     Reuse an installed Chrome / Chromium executable
  --cdp URL           Connect to an existing Chromium debugging endpoint
  --no-install        Fail instead of downloading a missing browser
  --install-browser   Install Playwright Chromium explicitly
  --fps N             Maximum frame rate, 1–60 (default 15)
  --mobile            Mobile viewport, touch and user agent
  --width N --height N Mobile viewport (defaults 390 × 844)
  --cell-width N      Fallback cell pixels if terminal omits geometry (8)
  --cell-height N     Fallback cell pixels if terminal omits geometry (16)
  --force             Bypass terminal graphics capability check
  --skill             Print the bundled agent skill
  --help              Show this help

Requires Node 22+ and a Kitty graphics terminal. Quit: Ctrl+Q.
Back/forward: Alt+Left/Right. Reload: Ctrl+R or F5.
Tabs: Ctrl+Tab / Ctrl+Shift+Tab. Close tab: Ctrl+W.
Local HTML and React edits reload automatically.
`;
let jsonOutput=false;
try {
  const { values, positionals } = parseArgs({ allowPositionals:true, options: {
    help:{type:'boolean',short:'h'}, skill:{type:'boolean'}, interactive:{type:'boolean',short:'i'}, full:{type:'boolean'}, timeout:{type:'string'}, text:{type:'string'}, url:{type:'string'}, session:{type:'string'}, json:{type:'boolean'}, root:{type:'string'}, chromium:{type:'string'}, cdp:{type:'string'}, 'no-install':{type:'boolean'}, 'install-browser':{type:'boolean'}, fps:{type:'string',default:'15'}, mobile:{type:'boolean'}, width:{type:'string',default:'390'}, height:{type:'string',default:'844'}, 'cell-width':{type:'string',default:'8'}, 'cell-height':{type:'string',default:'16'}, force:{type:'boolean'},
  } });
  jsonOutput=!!values.json;
  function number(value: string, name: string, max = 10000) { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} must be an integer between 1 and ${max}`); return n; }
  if (values.help) process.stdout.write(help);
  else if(values.skill)process.stdout.write(await readFile(new URL('../skills/starpane/SKILL.md',import.meta.url),'utf8'));
  else if(positionals[0]==='attach') {
    const name=values.session??positionals[1];
    if(!name||positionals.length!==(values.session?1:2))throw new Error('Use attach NAME or --session NAME attach.');
    await runAgent(name,{command:'attach',args:[]},values.json);
  }
  else if(values.session && agentCommands.has(positionals[0])) {
    await runAgent(values.session,{command:positionals[0],args:positionals.slice(1),interactive:values.interactive,full:values.full,timeout:values.timeout?number(values.timeout,'timeout',30000):undefined,text:values.text,url:values.url},values.json);
  }
  else if(agentCommands.has(positionals[0]))throw new Error('Agent commands require --session NAME.');
  else if(positionals[0]==='sessions') {
    if(values.session) throw new Error('Use sessions list or sessions delete NAME without --session.');
    if(positionals[1]==='list' && positionals.length===2) {
      const sessions=await listSessions();
      process.stdout.write(values.json ? JSON.stringify(sessions,null,2)+'\n' : sessions.length ? sessions.map(s=>`${s.name}\t${s.active ? 'active' : 'saved'}\t${s.updatedAt ?? 'not yet opened'}`).join('\n')+'\n' : 'No named sessions.\n');
    } else if(positionals[1]==='delete' && positionals.length===3) { await deleteSession(positionals[2]); process.stdout.write(`Deleted session ${positionals[2]}.\n`); }
    else throw new Error('Use sessions list [--json] or sessions delete NAME.');
  }
  else if (values['install-browser']) await installBrowser();
  else {
    if (positionals.length > 1 || (positionals.length===0 && !values.session)) throw new Error('Provide one HTML/React entry file or website URL. See --help.');
    await runSession({ target:positionals[0], name:values.session, root:values.root, chromium:values.chromium, cdp:values.cdp, install:!values['no-install'], fps:number(values.fps, 'fps', 60), mobile:values.mobile ? { width:number(values.width,'width'), height:number(values.height,'height') } : undefined, cellWidth:number(values['cell-width'],'cell-width'), cellHeight:number(values['cell-height'],'cell-height'), force:values.force });
  }
} catch (error) {
  const message=error instanceof Error?error.message:String(error);
  if(jsonOutput)process.stdout.write(JSON.stringify({ok:false,error:{code:error instanceof AgentError?error.code:'command_failed',message}})+'\n');
  else process.stderr.write(`starpane: ${message}\n`);
  process.exitCode=1;
}
