// Pinned upstream binaries for disposable CI runners; no Homebrew or Rust build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This installer is only for GitHub Actions runners.');
const assets = {
  'linux-x64': ['herdr-linux-x86_64', '976150a14d490c94b243ea2e1a7eb2dfb67f12e36b182db90936f6728e6aecf4'],
  'linux-arm64': ['herdr-linux-aarch64', 'f55610658e1c2e0d2aaef730b4b2ab885f7f8ba00285ab372bfb14f2e3d5b40d'],
  'darwin-x64': ['herdr-macos-x86_64', 'ab50262c8190cd7aa9056d249d255c08c328c3e8716de9cfa29db4f131b8e2c1'],
  'darwin-arm64': ['herdr-macos-aarch64', 'a5d4f4d504d8b309c91f811050559300faba31258425f53c50852fc96f6ae574'],
};
const asset = assets[`${process.platform}-${process.arch}`];
assert.ok(asset, 'Unsupported HerdR runner platform');
const [name, sha256] = asset;
const response = await fetch(`https://github.com/herdrdev/herdr/releases/download/v0.8.2/${name}`, {
  signal: AbortSignal.timeout(120_000),
});
assert.ok(response.ok, `HerdR download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, 'HerdR checksum mismatch');
const directory = join(process.env.RUNNER_TEMP, 'herdr-bin');
await mkdir(directory, { recursive: true });
const binary = join(directory, 'herdr');
await writeFile(binary, bytes, { mode: 0o755 });
assert.equal(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(), 'herdr 0.8.2');
await appendFile(process.env.GITHUB_PATH, directory + '\n');
console.log(`Installed verified HerdR 0.8.2: ${name}`);
