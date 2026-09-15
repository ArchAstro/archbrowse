import { test } from 'node:test';
import assert from 'node:assert/strict';
import { herdrSocketAddress } from '../src/herdr.js';

test('HerdR Windows logical socket identifiers use the upstream named-pipe namespace',()=>{
  // This shape reproduced ENOTSOCK on a native Windows CI runner.
  const logical=String.raw`C:\Users\runneradmin\AppData\Roaming\herdr\sessions\demo\herdr.sock`;
  assert.equal(herdrSocketAddress(logical,'win32'),String.raw`\\.\pipe\C:\Users\runneradmin\AppData\Roaming\herdr\sessions\demo\herdr.sock`);
  const native=String.raw`\\.\pipe\herdr-test`;
  assert.equal(herdrSocketAddress(native,'win32'),native);
  // Do not canonicalize separators, Unicode or case: they are part of the pipe name.
  assert.equal(herdrSocketAddress('D:/Work Space/日本/herdr.sock','win32'),String.raw`\\.\pipe\D:/Work Space/日本/herdr.sock`);
  assert.equal(herdrSocketAddress('/tmp/herdr.sock','linux'),'/tmp/herdr.sock');
  assert.equal(herdrSocketAddress('/tmp/herdr.sock','darwin'),'/tmp/herdr.sock');
});
