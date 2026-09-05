import { spawn, type IPty } from 'node-pty';
import { PNG } from 'pngjs';
import { resolve } from 'node:path';

/** Independent test receiver, not production encode/decode code. */
export class Terminal {
  pty: IPty;
  frames: Buffer[] = [];
  transcript = '';
  ended: number | undefined;
  private pending = '';
  private image = '';
  cols = 100; rows = 50; cellWidth = 8; cellHeight = 16;
  constructor(args: string[], readonly pixel = true, env:NodeJS.ProcessEnv = {}) {
    this.pty = spawn(process.execPath, [resolve('dist/cli.js'), ...args], { name:'xterm-kitty', cols:this.cols, rows:this.rows, cwd:process.cwd(), env:{ ...process.env, ...env, HERDR_ENV:'', HERDR_SOCKET_PATH:'', HERDR_PANE_ID:'', TERM:'xterm-kitty', TMUX:'' } });
    this.pty.onExit(e => { this.ended = e.exitCode; });
    this.pty.onData(data => { this.transcript += data; this.pending += data; this.parse(); });
  }
  private parse() {
    while (this.pending) {
      const start = this.pending.indexOf('\x1b');
      if (start < 0) { this.pending = ''; return; }
      this.pending = this.pending.slice(start);
      if (this.pending.startsWith('\x1b_G')) {
        const end = this.pending.indexOf('\x1b\\'); if (end < 0) return;
        const content = this.pending.slice(3,end), split = content.indexOf(';');
        const header = split < 0 ? content : content.slice(0,split), payload = split < 0 ? '' : content.slice(split+1);
        const params = Object.fromEntries(header.split(',').map(s=>s.split('=')));
        if (params.a === 'q') this.write('\x1b_Gi=31;OK\x1b\\');
        else if (params.a === 'T' || params.m !== undefined) {
          if (params.a === 'T') this.image = '';
          if (payload.length > 4096) throw new Error('Kitty payload overflow');
          this.image += payload;
          if (params.m === '0') { const png = Buffer.from(this.image,'base64'); PNG.sync.read(png); this.frames.push(png); if (this.frames.length > 12) this.frames.shift(); }
        }
        this.pending = this.pending.slice(end+2); continue;
      }
      const csi = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(this.pending);
      if (csi) {
        const command = csi[0]; this.pending = this.pending.slice(command.length);
        if (command === '\x1b[16t') this.write(`\x1b[6;${this.cellHeight};${this.cellWidth}t`);
        if (command === '\x1b[14t') this.write(`\x1b[4;${this.rows*this.cellHeight};${this.cols*this.cellWidth}t`);
        if (command === '\x1b[?1016$p') this.write(`\x1b[?1016;${this.pixel ? 2 : 0}$y`);
        continue;
      }
      if (this.pending.length < 3 || this.pending.startsWith('\x1b[')) return;
      this.pending = this.pending.slice(2);
    }
  }
  write(s: string) { this.pty.write(s); }
  mouse(code: number, x: number, y: number, release = false) {
    const cx = this.pixel ? Math.round(x) + 1 : Math.floor(x / this.cellWidth) + 1;
    const cy = this.pixel ? Math.round(y) + 1 : Math.floor(y / this.cellHeight) + 1;
    this.write(`\x1b[<${code};${cx};${cy}${release ? 'm' : 'M'}`);
  }
  resize(cols:number,rows:number) { this.cols=cols; this.rows=rows; this.pty.resize(cols,rows); }
  async close() { if (this.ended !== undefined) return; this.write('\x11'); try { await waitFor(() => this.ended !== undefined, 'CLI exit', 10000); } finally { if (this.ended === undefined) this.pty.kill(); } }
}
export async function waitFor(predicate: () => boolean | Promise<boolean>, label:string, timeout=15000) {
  const end = Date.now()+timeout;
  while(Date.now()<end) { if (await predicate()) return; await new Promise(r=>setTimeout(r,40)); }
  throw new Error(`Timed out: ${label}`);
}
export function samePixels(a: Buffer,b: Buffer) {
  const x=PNG.sync.read(a), y=PNG.sync.read(b);
  return x.width===y.width && x.height===y.height && x.data.equals(y.data);
}
