// node-pty 1.1.0's prebuilt macOS spawn helper can arrive as mode 0644.
// Set only the executable bits on that package-owned helper, before PTY tests.
import { chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const helper = join(dirname(require.resolve('node-pty/package.json')), 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
  const info = await stat(helper);
  if (!(info.mode & 0o111)) { await chmod(helper, info.mode | 0o111); console.log('Enabled node-pty macOS spawn helper.'); }
}
