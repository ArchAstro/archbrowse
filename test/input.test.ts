import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputParser, type Input } from '../src/input.js';
import { encodeFrame, point } from '../src/kitty.js';
function parse(s: string | Buffer, bytewise = false) { const events: Input[] = []; const parser = new InputParser(e => events.push(e)); if (bytewise) for (const byte of Buffer.from(s)) parser.push(Buffer.from([byte])); else parser.push(s); return events; }
test('UTF-8, mouse, paste, key releases and terminal responses survive every byte boundary', () => {
  const stream = 'hé😀\x1b[<0;120;200M\x1b[<0;120;200m\x1b[200~你好\n\x1b[not-a-key\x1b[201~\x1b[97;5:3u\x1b[6;20;10t\x1b[?1016;2$y\x1b_Gi=31;OK\x1b\\';
  assert.deepEqual(parse(stream, true), parse(stream));
  assert.equal(parse(stream).filter(e => e.type === 'key').length, 4);
  assert.deepEqual(parse('\x1b[97;5:3u')[0], { type:'key', key:'a', modifiers:['Control'], event:'release', text:undefined, held:true });
});
test('legacy modifiers, shift tab, isolated escape, bracketed paste', () => {
  assert.equal((parse('\x1b[1;5D')[0] as any).key, 'ArrowLeft');
  assert.deepEqual((parse('\x1b[Z')[0] as any).modifiers, ['Shift']);
  const events:Input[] = [], parser = new InputParser(e => events.push(e)); parser.push('\x1b'); assert.equal(events.length,0); parser.flushEscape(); assert.equal((events[0] as any).key,'Escape');
  assert.deepEqual(parse('\x1b[200~\x03\nこんにちは\x1b[201~'), [{type:'paste',text:'\x03\nこんにちは'}]);
});
test('frame payload is lossless, chunk bounded and old image deleted after display', () => {
  const source = Buffer.alloc(14000, 173), encoded = encodeFrame(source, 80, 30);
  const packets = [...encoded.matchAll(/\x1b_G([^;\x1b]+);([^\x1b]*)\x1b\\/g)];
  assert.ok(packets.length > 1); assert.ok(packets.every(p => p[2].length <= 4096));
  assert.deepEqual(Buffer.from(packets.map(p=>p[2]).join(''),'base64'), source);
  assert.match(encoded, /c=80,r=30/); assert.ok(encoded.lastIndexOf('d=I,i=102') > encoded.lastIndexOf(';'));
});
test('cell and pixel mapping agree at cell centers including mobile scaling', () => {
  const g = { columns:100, rows:40, cellWidth:8, cellHeight:16 }, view = { width:390,height:844 };
  assert.deepEqual(point(10,10,false,g,view), point(77,153,true,g,view));
});
test('unsupported Kitty functional keys and replies never become inserted characters', () => {
  assert.deepEqual(parse('\x1b[57363u\x1b[?31u\x1b[?1;2c'),[]);
});
test('enhanced arrow releases are not duplicated presses; OSC BEL terminates', () => {
  const events=parse('\x1b[1;2:3A\x1b]52;c;abc\x07x',true);
  assert.equal((events[0] as any).event,'release');
  assert.equal((events[0] as any).held,true);
  assert.equal((events[1] as any).key,'x');
});
