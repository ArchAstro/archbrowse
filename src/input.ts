import { StringDecoder } from 'node:string_decoder';
export type Input =
  | { type: 'key'; key: string; modifiers: string[]; event: 'press' | 'repeat' | 'release'; text?: string; held?: boolean }
  | { type: 'paste'; text: string }
  | { type: 'mouse'; code: number; x: number; y: number; release: boolean }
  | { type: 'size'; kind: number; height: number; width: number }
  | { type: 'mode'; mode: number; status: number }
  | { type: 'graphics'; ok: boolean }
  | { type: 'focus'; focused: boolean };
const names: Record<number, string> = { 27:'Escape', 13:'Enter', 9:'Tab', 127:'Backspace', 57344:'Escape', 57345:'Enter', 57346:'Tab', 57347:'Backspace', 57348:'Insert', 57349:'Delete', 57350:'ArrowLeft', 57351:'ArrowRight', 57352:'ArrowUp', 57353:'ArrowDown', 57354:'PageUp', 57355:'PageDown', 57356:'Home', 57357:'End', 57441:'Shift', 57442:'Control', 57443:'Alt', 57444:'Meta', 57447:'Shift', 57448:'Control', 57449:'Alt', 57450:'Meta' };
for (let n = 0; n < 35; n++) names[57364 + n] = `F${n + 1}`;
const arrows: Record<string, string> = { A:'ArrowUp', B:'ArrowDown', C:'ArrowRight', D:'ArrowLeft', H:'Home', F:'End', P:'F1', Q:'F2', R:'F3', S:'F4', Z:'Tab' };
const tilde: Record<number, string> = { 1:'Home', 2:'Insert', 3:'Delete', 4:'End', 5:'PageUp', 6:'PageDown', 7:'Home', 8:'End', 11:'F1', 12:'F2', 13:'F3', 14:'F4', 15:'F5', 17:'F6', 18:'F7', 19:'F8', 20:'F9', 21:'F10', 23:'F11', 24:'F12' };
export function modifiers(value: number) { const bits = value - 1; return [[1,'Shift'],[2,'Alt'],[4,'Control'],[8,'Meta']].filter(([bit]) => bits & Number(bit)).map(([, name]) => String(name)); }
const keyName = (code: number) => names[code] ?? (code >= 32 && code <= 0x10ffff && !(code >= 57344 && code <= 63743) && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : undefined);

/** Incremental UTF-8 / escape parser: PTY chunks are not event boundaries. */
export class InputParser {
  private decoder = new StringDecoder('utf8');
  private pending = '';
  constructor(private emit: (event: Input) => void) {}
  push(bytes: Buffer | string) { this.pending += typeof bytes === 'string' ? bytes : this.decoder.write(bytes); this.parse(); }
  flushEscape() { if (this.pending === '\x1b') { this.pending = ''; this.key('Escape'); } }
  private key(key: string, mods: string[] = [], event: 'press' | 'repeat' | 'release' = 'press', text?: string, held = false) { this.emit({ type: 'key', key, modifiers: mods, event, text, held }); }
  private parse() {
    while (this.pending) {
      const s = this.pending;
      if (s.startsWith('\x1b[200~')) {
        const end = s.indexOf('\x1b[201~', 6); if (end < 0) return;
        this.emit({ type:'paste', text: s.slice(6, end) }); this.pending = s.slice(end + 6); continue;
      }
      if (s.startsWith('\x1b_G') || s.startsWith('\x1b]') || s.startsWith('\x1bP')) {
        const st = s.indexOf('\x1b\\'), bell = s.startsWith('\x1b]') ? s.indexOf('\x07') : -1;
        const end = st < 0 ? bell : bell < 0 ? st : Math.min(st,bell); if (end < 0) return;
        if (s.startsWith('\x1b_G')) this.emit({ type:'graphics', ok: /;OK$/.test(s.slice(0, end)) });
        this.pending = s.slice(end + (end === bell ? 1 : 2)); continue;
      }
      if (s.startsWith('\x1b[')) {
        const match = /^\x1b\[([0-?]*)([ -/]*)([@-~])/.exec(s); if (!match) return;
        this.pending = s.slice(match[0].length);
        const [, args, intermediate, end] = match;
        const parts = args.split(';');
        if (end === 't' && /^[468];/.test(args)) { this.emit({ type:'size', kind:Number(parts[0]), height:Number(parts[1]), width:Number(parts[2]) }); continue; }
        if (end === 'y' && intermediate === '$' && args.startsWith('?')) { this.emit({ type:'mode', mode:Number(parts[0].slice(1)), status:Number(parts[1]) }); continue; }
        if ((end === 'M' || end === 'm') && args.startsWith('<')) {
          this.emit({ type:'mouse', code:Number(parts[0].slice(1)), x:Number(parts[1]), y:Number(parts[2]), release:end === 'm' }); continue;
        }
        if (end === 'I' || end === 'O') { this.emit({ type:'focus', focused:end === 'I' }); continue; }
        if (end === 'u' && /^\d/.test(args)) {
          const code = Number(parts[0].split(':')[0]);
          const [mod = '1', ev = '1'] = (parts[1] ?? '').split(':');
          const key = keyName(code);
          const text = parts[2]?.split(':').map(Number).filter(c => c >= 32 && c <= 0x10ffff).map(c => String.fromCodePoint(c)).join('');
          if (key) this.key(key, modifiers(Number(mod)), ev === '3' ? 'release' : ev === '2' ? 'repeat' : 'press', text, true);
          continue;
        }
        if (end === '~' && parts[0] === '27' && parts[2]) { const key = keyName(Number(parts[2])); if (key) this.key(key, modifiers(Number(parts[1]))); continue; }
        const key = end === '~' ? tilde[Number(parts[0])] : arrows[end];
        if (key) { const [mod = '1', ev] = (parts[1] ?? '').split(':'); this.key(key, end === 'Z' ? ['Shift'] : modifiers(Number(mod)), ev === '3' ? 'release' : ev === '2' ? 'repeat' : 'press', undefined, ev !== undefined); }
        continue;
      }
      if (s.startsWith('\x1bO')) {
        if (s.length < 3) return;
        if (arrows[s[2]]) this.key(arrows[s[2]]);
        this.pending = s.slice(3); continue;
      }
      if (s === '\x1b') return;
      if (s[0] === '\x1b' && s.length > 1) {
        // Wait for a possible split APC introducer.
        if (s === '\x1b_') return;
        const cp = s.codePointAt(1)!; const key = keyName(cp);
        if (key) this.key(key, ['Alt']);
        this.pending = s.slice(1 + String.fromCodePoint(cp).length); continue;
      }
      const cp = s.codePointAt(0)!; this.pending = s.slice(String.fromCodePoint(cp).length);
      if (cp === 0) this.key(' ', ['Control']);
      else if (cp === 10 || cp === 13) this.key('Enter');
      else if (cp === 9) this.key('Tab');
      else if (cp === 127 || cp === 8) this.key('Backspace');
      else if (cp < 27) this.key(String.fromCharCode(96 + cp), ['Control']);
      else { const key = keyName(cp); if (key) this.key(key); }
    }
  }
}
