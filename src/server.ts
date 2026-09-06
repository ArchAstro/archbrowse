import { context, formatMessages, type BuildResult } from 'esbuild';
import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

/** In-memory build + reload server. Never writes into the user's project. */
export async function serveReact(file: string, port = 0) {
  const entry = resolve(file);
  if (!['.tsx', '.jsx', '.js', '.ts'].includes(extname(entry))) throw new Error('Expected a .tsx, .jsx, .js or .ts entry file.');
  if (!(await stat(entry)).isFile()) throw new Error(`Not a file: ${entry}`);
  const root = dirname(entry), outputDir = resolve(root, '.archbrowse-output');
  const clients = new Set<ServerResponse>();
  let outputs = new Map<string, Uint8Array>(), errors: string[] = [], revision = 0;
  function publish() {
    for (const client of clients) client.write(`data: ${JSON.stringify({ errors, revision })}\n\n`);
  }
  async function built(result: BuildResult) {
    errors = await formatMessages(result.errors, { kind: 'error', color: false });
    if (!errors.length) {
      outputs = new Map(result.outputFiles!.map(f => ['/' + relative(outputDir, f.path).split(sep).join('/'), f.contents]));
      revision++;
    }
    publish();
  }
  const require = createRequire(import.meta.url);
  const builder = await context({
    absWorkingDir: root,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import * as entry from ${JSON.stringify(entry)}; const Root = entry.default ?? entry.App; if (Root) createRoot(document.getElementById('root'), {onUncaughtError: error => window.dispatchEvent(new CustomEvent('archbrowse-error', {detail:String(error?.stack || error)}))}).render(React.createElement(Root));`, resolveDir: root, sourcefile: 'archbrowse-entry.tsx', loader: 'tsx' },
    nodePaths: [resolve(dirname(require.resolve('react/package.json')), '..')],
    bundle: true, write: false, outdir: outputDir, entryNames: 'bundle', assetNames: 'assets/[name]-[hash]',
    format: 'esm', platform: 'browser', target: 'chrome110', jsx: 'automatic', sourcemap: 'inline',
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.js': 'jsx', '.png': 'file', '.jpg': 'file', '.svg': 'file', '.woff': 'file', '.woff2': 'file' },
    logLevel: 'silent', plugins: [{ name: 'live-reload', setup(build) { build.onEnd(built); } }],
  });
  const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.html': 'text/html' };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%}#build-error,#runtime-error{position:fixed;inset:0;z-index:2147483647;background:#210e18;color:#ffd7e4;padding:24px;white-space:pre-wrap;font:14px monospace;overflow:auto}</style><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script><script>
    function showRuntime(message) { let panel = document.getElementById('runtime-error'); if (!panel) { panel=document.createElement('pre'); panel.id='runtime-error'; document.body.append(panel); } panel.textContent=message; }
    window.addEventListener('error', e => showRuntime(e.error?.stack || e.message));
    window.addEventListener('unhandledrejection', e => showRuntime(String(e.reason?.stack || e.reason)));
    window.addEventListener('archbrowse-error', e => showRuntime(e.detail));
    let revision; const stream = new EventSource('/__archbrowse/events');
    stream.onmessage = e => { const next = JSON.parse(e.data); let panel = document.getElementById('build-error');
      if (next.errors.length) { if (!panel) { panel = document.createElement('pre'); panel.id = 'build-error'; document.body.append(panel); } panel.textContent = next.errors.join('\\n'); }
      else { panel?.remove(); if (revision !== undefined && revision !== next.revision) location.reload(); }
      revision = next.revision;
    };
    </script></body></html>`;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      if (path === '/__archbrowse/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        clients.add(res); res.write(`data: ${JSON.stringify({ errors, revision })}\n\n`);
        req.on('close', () => clients.delete(res)); return;
      }
      if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html.replace('let revision;', `let revision = ${revision};`)); return; }
      if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      if (outputs.has(path)) { res.end(outputs.get(path)); return; }
      if (path === '/bundle.css') { res.end(''); return; }
      // Static public assets only: do not expose source files, .env or node_modules.
      const assetRoot = resolve(root, 'public');
      const asset = resolve(assetRoot, '.' + path);
      if (!asset.startsWith(assetRoot + sep) || path.split('/').some(s => s.startsWith('.'))) { res.writeHead(403).end(); return; }
      res.end(await readFile(asset));
    } catch { res.writeHead(404).end('Not found'); }
  });
  try {
    await builder.watch();
    // Explicit rebuild guarantees initial output is ready before handing the URL out.
    await builder.rebuild().catch(() => {}); // Build errors are displayed in the browser overlay.
    await new Promise<void>((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  } catch (error) { await builder.dispose(); server.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return { url: `http://127.0.0.1:${address.port}`, async close() {
    for (const client of clients) client.end();
    server.closeAllConnections();
    await Promise.all([builder.dispose(), new Promise<void>((r, j) => server.close(e => e ? j(e) : r()))]);
  } };
}
