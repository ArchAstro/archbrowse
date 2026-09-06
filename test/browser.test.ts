import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium } from '../src/browser.js';
test('explicit browser choice is honored and invalid paths fail clearly', async()=> {
  const installed = await findChromium();
  if (installed) assert.equal(await findChromium(installed),installed);
  await assert.rejects(()=>findChromium('/does-not-exist/archbrowse-chrome'), /Chromium executable not found/);
});
