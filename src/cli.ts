#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runSession } from './session.js';
import { listSessions, deleteSession } from './sessions.js';
import { installBrowser } from './browser.js';
const help = `react-kitty — React and websites in your terminal

  react-kitty ./App.tsx             Live React entry (default export or App)
  react-kitty ./app.jsx             JSX / JS / TS also accepted
  react-kitty ./index.html         Local HTML with relative assets and live reload
  react-kitty https://example.com   Any HTTP(S) website
  react-kitty example.com           Bare domains default to HTTPS
  react-kitty localhost:3000        Local dev server
  react-kitty ./App.tsx --mobile    390 × 844 CSS pixels + touch emulation

  react-kitty example.com --session work  Create/reuse a saved browser profile
  react-kitty --session work              Reopen saved pages
  react-kitty sessions list               List named sessions
  react-kitty sessions delete work        Delete an inactive profile

  --session NAME      Persist cookies, site storage and open URLs
  --json              Machine-readable output for sessions list
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
  --help              Show this help

Requires Node 22+ and a Kitty graphics terminal. Quit: Ctrl+Q.
Back/forward: Alt+Left/Right. Reload: Ctrl+R or F5.
Tabs: Ctrl+Tab / Ctrl+Shift+Tab. Close tab: Ctrl+W.
Local HTML and React edits reload automatically.
`;
try {
  const { values, positionals } = parseArgs({ allowPositionals:true, options: {
    help:{type:'boolean',short:'h'}, session:{type:'string'}, json:{type:'boolean'}, root:{type:'string'}, chromium:{type:'string'}, cdp:{type:'string'}, 'no-install':{type:'boolean'}, 'install-browser':{type:'boolean'}, fps:{type:'string',default:'15'}, mobile:{type:'boolean'}, width:{type:'string',default:'390'}, height:{type:'string',default:'844'}, 'cell-width':{type:'string',default:'8'}, 'cell-height':{type:'string',default:'16'}, force:{type:'boolean'},
  } });
  function number(value: string, name: string, max = 10000) { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} must be an integer between 1 and ${max}`); return n; }
  if (values.help) process.stdout.write(help);
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
} catch (error) { process.stderr.write(`react-kitty: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
