import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright-core';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

async function executable(path: string) { try { await access(path, constants.X_OK); return true; } catch { return false; } }
export async function findChromium(explicit?: string): Promise<string | undefined> {
  if (explicit) { if (!await executable(explicit)) throw new Error(`Chromium executable not found: ${explicit}`); return explicit; }
  const candidates = [chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(key => process.env[key] ? [join(process.env[key]!, 'Google/Chrome/Application/chrome.exe'), join(process.env[key]!, 'Microsoft/Edge/Application/msedge.exe')] : []),
    ...(process.env.PATH ?? '').split(delimiter).flatMap(dir => ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].map(name => join(dir, name)))];
  for (const path of candidates) if (await executable(path)) return path;
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library/Caches/ms-playwright'), join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright'), join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')].filter((x): x is string => !!x);
  for (const cache of caches) {
    const dirs = await readdir(cache).catch(() => []);
    for (const dir of dirs.filter(d => /^chromium(-|_headless_shell-)/.test(d)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const suffix of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-headless-shell-mac-arm64/headless_shell', 'chrome-headless-shell-linux64/headless_shell']) {
        const path = join(cache, dir, suffix); if (await executable(path)) return path;
      }
    }
  }
}
export interface BrowserOptions { executable?:string; cdp?:string; install?:boolean; log?:(message:string)=>void }
async function browserExecutable(options:BrowserOptions) {
  let path = await findChromium(options.executable ?? process.env.ARCHBROWSE_CHROMIUM ?? process.env.STARPANE_CHROMIUM ?? process.env.REACT_KITTY_CHROMIUM);
  if (!path) {
    if (options.install === false) throw new Error('No Chromium found. Set --chromium /path/to/chrome or run archbrowse --install-browser.');
    options.log?.('No installed Chromium found; downloading Playwright Chromium once…');
    await installBrowser(); path = chromium.executablePath();
  }
  options.log?.(`Using Chromium: ${path}`);
  return path;
}
export async function openBrowser(options:BrowserOptions = {}):Promise<Browser> {
  if(options.cdp) return chromium.connectOverCDP(options.cdp);
  return chromium.launch({executablePath:await browserExecutable(options),headless:true});
}
export async function openPersistentBrowser(profile:string, contextOptions:BrowserContextOptions, options:BrowserOptions = {}):Promise<BrowserContext> {
  if(options.cdp) throw new Error('--session cannot be combined with --cdp; named sessions own their browser profile.');
  return chromium.launchPersistentContext(profile,{...contextOptions,executablePath:await browserExecutable(options),headless:true,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false});
}
export async function installBrowser() {
  const require = createRequire(import.meta.url);
  const cli = join(require.resolve('playwright-core/package.json'), '..', 'cli.js');
  await new Promise<void>((yes, no) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', no); child.on('exit', code => code === 0 ? yes() : no(new Error(`Chromium installer exited ${code}`)));
  });
}
