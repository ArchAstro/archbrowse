// Exercise the distributable outside this checkout, with production dependencies.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'archbrowse-package-'));
const run = (command, args, cwd = directory) => execFileSync(command, args, {
  cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], process.cwd()))[0];
  const files = new Set(packed.files.map(file => file.path));
  for (const path of ['dist/cli.js', 'examples/App.tsx', 'skills/archbrowse/SKILL.md',
    'skills/archbrowse/scripts/bootstrap.mjs', 'skills/archbrowse/scripts/preferences.mjs']) {
    assert.ok(files.has(path), `Missing package file: ${path}`);
  }
  run('npm', ['install', '--prefix', directory, '--omit=dev', '--no-audit', '--no-fund', join(directory, packed.filename)]);
  const root = join(directory, 'node_modules/@archastro/archbrowse');
  for (const name of ['archbrowse', 'starpane', 'react-kitty']) {
    assert.match(run(join(directory, 'node_modules/.bin', name), ['--help']), /^archbrowse —/);
  }
  assert.equal(run(join(directory, 'node_modules/.bin/archbrowse'), ['--skill']),
    await readFile(join(root, 'skills/archbrowse/SKILL.md'), 'utf8'));
  // Loading the installed CLI checks that every runtime import ships as a
  // production dependency; invoking aliases checks npm's executable links.
  console.log('Packed CLI, all aliases, production imports and bundled skill passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
