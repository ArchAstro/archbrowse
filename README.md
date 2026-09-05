# React Kitty

Run React apps, arbitrary HTTP(S) websites, and local HTML files inside a Kitty graphics terminal. Chromium renders the DOM, CSS, SVG, canvas and browser events; the CLI transports pixels and terminal input. Source edits rebuild automatically.

```fish
npm install
npm run build
node dist/cli.js examples/App.tsx
```

Use **Node 22+** and a terminal implementing Kitty graphics, such as Kitty or Ghostty. Quit with **Ctrl+Q**. No browser was downloaded during development or tests: the CLI reused installed Chromium.

## 1. Run your component

```fish
node dist/cli.js /path/to/App.tsx
node dist/cli.js /path/to/App.jsx
node dist/cli.js /path/to/App.js
node dist/cli.js https://example.com
node dist/cli.js example.com
node dist/cli.js localhost:3000
node dist/cli.js ./index.html
node dist/cli.js examples/App.tsx --mobile
```

Export a React component as `default` or `App`:

```tsx
import { useState } from 'react';
import './styles.css';

export default function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

1. `.tsx`, `.jsx`, `.js` (including JSX), and `.ts` entries work. Entries that mount themselves can use the supplied `#root` element.
2. Local imports, installed project dependencies, CSS imports, imported images/fonts and `public/` assets work. React/React DOM fall back to the CLI's dependencies when the project doesn't supply them.
3. Edits anywhere in the bundled dependency graph trigger a **full reload**. Component state resets. Compile errors retain the last build behind an error overlay; runtime errors also appear in the page. Fixing the file reloads the app.
4. This is a client-side esbuild environment. It does not run a project's Vite/Next configuration, SSR, server components, or backend. For those projects, start their dev server and pass its URL.
5. Local code executes with normal browser capabilities. Only the generated build and `public/` assets are served, bound to an ephemeral loopback port. No files are written into your app.

### Websites and local HTML

```fish
node dist/cli.js example.com
node dist/cli.js 'https://example.com/path?query=value'
node dist/cli.js localhost:3000
node dist/cli.js ./site/index.html
node dist/cli.js ./site/pages/about.htm --root ./site
node dist/cli.js 'file:///absolute/path/site/index.html'
```

1. Full HTTP/HTTPS URLs open directly in Chromium. Bare domains use HTTPS; localhost and loopback addresses use HTTP. Redirects, page scripts, links and forms use normal browser behavior. Sites can still require login or reject automated browsers.
2. `.html` and `.htm` documents are served **unchanged** from an ephemeral loopback HTTP server. Relative CSS, JavaScript modules, images, fonts, fetch requests, links and media range requests work. No React runtime is added. A static HTML site has no server-side POST handler; point at your running backend for that.
3. The entry file's directory is the default document root. `--root` selects a parent directory for nested pages and shared assets. Paths outside the root, escaping symlinks, and hidden paths are not served. `file:` inputs use the same HTTP server, preserving query/fragment and avoiding browser file-origin module restrictions.
4. Changes to the entry or loaded local assets reload local pages, including background tabs. This is a full reload; state resets. HTTP cache is disabled for local assets.
5. New-window links and `window.open()` become active tabs. **Ctrl+Tab / Ctrl+Shift+Tab** switch tabs, **Ctrl+W** closes the active tab, and closing the final tab exits. **Alt+Left / Alt+Right** go back/forward; **Ctrl+R**, **Command+R**, or **F5** reload. Terminal-reserved shortcuts may require terminal configuration.

Try the complete plain-HTML example:

```fish
node dist/cli.js examples/html/index.html
node dist/cli.js examples/html/index.html --mobile
```

### Running inside HerdR

HerdR requires its pane-graphics API; raw Kitty escapes from a pane are not forwarded to the outer terminal. React Kitty detects `HERDR_ENV`, targets the calling `HERDR_PANE_ID`, and streams frames through `HERDR_SOCKET_PATH`. The stream's owned image layer is removed on exit. Direct Ghostty/Kitty uses the regular Kitty transport.

When graphics are disabled, launching React Kitty offers to update your HerdR config and reload it:

```text
Enable experimental.kitty_graphics in /path/to/config.toml and reload HerdR? [y/N]
```

Answer `y` to apply it. The edit preserves comments, unrelated keys and symlinks, and saves a backup. Answering `n` leaves the file untouched. The CLI honors `HERDR_CONFIG_PATH` and refuses to overwrite edits made while the prompt was open. If graphics are already enabled, it explains the running-client limitation without offering a redundant write.

The equivalent manual setting is:

```toml
[experimental]
kitty_graphics = true
```

Run `herdr server reload-config`, then detach and reattach the HerdR client so it discovers the host terminal's graphics and cell-size capabilities. Run React Kitty normally inside a pane:

```fish
node dist/cli.js example.com
```

The CLI automatically retries dimension discovery for up to five seconds before launching Chromium. HerdR 0.8.2 latches the client graphics setting at startup: `reload-config` updates other client settings but does not enable graphics in a client started with it disabled. That existing client requires one reattachment; the public API has no operation to enable its graphics flag in place. `--force` cannot enable HerdR rendering. HerdR's virtual terminal can answer a Kitty support query with `OK` even while image rendering is disabled, so that reply alone is not used as proof of support. Mouse coordinates use pane-relative pixel reporting when HerdR advertises pixel mouse support. This keeps small links clickable even with large/high-DPI terminal cells. Older clients fall back to cell reporting.

## Named sessions

```fish
# Create a session or use its existing browser profile
node dist/cli.js example.com --session work
node dist/cli.js ./App.tsx --session preview

# Reopen saved tabs without repeating the target
node dist/cli.js --session work
node dist/cli.js --session preview

# Manage profiles
node dist/cli.js sessions list
node dist/cli.js sessions list --json
node dist/cli.js sessions delete work
```

1. **Persistence:** each name owns a private Chromium profile. Cookies (including session cookies), localStorage and IndexedDB survive clean exits. Open HTTP(S) tab URLs and the active tab are saved and reopened. Site login expiration rules still apply.
2. **Lifecycle:** Ctrl+Q saves state and closes Chromium. Reopening starts a new browser process and reloads the pages. JavaScript/React memory, unsaved form edits, navigation history and `sessionStorage` are not restored. There is no background daemon or live detach/reattach.
3. **Targets:** omitting the target reopens saved tabs. Supplying a target uses the same profile but starts at that target. Local paths and `--root` are saved as absolute paths; the mobile viewport setting is remembered.
4. **Local apps:** a named session reuses its HTTP port so the origin—and therefore localStorage/IndexedDB—stays stable. If another process occupies that port, startup fails instead of silently changing the origin. Local files must still exist when reopening.
5. **Isolation:** names use separate profiles and allow only one active CLI per name. Another launch or deletion is refused while the session is active. A crashed CLI's heartbeat lock becomes reclaimable after 10 seconds. Clean exit is required for the latest tab/cookie snapshot.
6. **Storage:** defaults to `$XDG_DATA_HOME/react-kitty/sessions`, or `~/.local/share/react-kitty/sessions`. `REACT_KITTY_SESSIONS_DIR` overrides the directory. Directories use mode `0700` and metadata/cookie files use `0600` on Unix. These files contain browsing state; deleting a session removes its profile and saved state.
7. **Names:** 1–64 lowercase letters, digits, hyphens or underscores; the first character must be a letter or digit. `--session` cannot be combined with `--cdp`, since named sessions must own their profile. Without `--session`, launches remain temporary.

## Let an agent drive a live session

Start the viewer in one terminal:

```fish
node dist/cli.js ./App.tsx --session work
```

From another shell or agent process, use the same session name:

```fish
node dist/cli.js attach work
node dist/cli.js --session work snapshot -i
# Use the exact ref printed by the snapshot:
node dist/cli.js --session work fill @eabcd_2 "Ada"
node dist/cli.js --session work click @eabcd_3
node dist/cli.js --session work wait --text "Welcome"
node dist/cli.js --session work snapshot -i
node dist/cli.js --session work screenshot ./page.png
```

The agent drives the **same Chromium page displayed in the terminal**, including the same login, React state and storage. This also works when the viewer is inside HerdR. The viewer must remain running; an inactive saved session returns `session_not_running`. `attach NAME` reports the live session's URL/title/tab. Pass `--session NAME` on each action so the target stays explicit.

The interface follows agent-browser's documented snapshot/ref/action loop; its implementation is original and uses the viewer's existing Playwright context.

| Command | Purpose |
| --- | --- |
| `snapshot [-i]` | Accessibility tree and compact interactive refs |
| `read` | Visible body text |
| `click`, `dblclick`, `hover`, `focus` `REF_OR_SELECTOR` | Interact with an element |
| `fill`, `type` `REF_OR_SELECTOR TEXT` | Replace text or type at the element |
| `press KEY` | Key/chord at current focus, e.g. `Enter` or `Control+a` |
| `check`, `uncheck` `REF_OR_SELECTOR` | Checkbox state |
| `select REF_OR_SELECTOR VALUE...` | Select option values |
| `scroll up\|down\|left\|right [PIXELS]` | Scroll, default 500 pixels |
| `get url\|title` | Current page metadata |
| `get text\|html\|value REF_OR_SELECTOR` | Element contents |
| `get attr REF_OR_SELECTOR NAME` | Element attribute |
| `wait SELECTOR`, `wait --text TEXT`, `wait --url GLOB` | Wait for a product condition |
| `screenshot PATH [--full]` | Save a PNG at the caller's resolved path |
| `open URL`, `back`, `forward`, `reload` | Navigate the active tab |
| `tab list`, `tab new [URL]`, `tab t1`, `tab close [t1]` | Inspect, open, switch and close tabs |
| `eval JAVASCRIPT` | Evaluate JavaScript in the active page |

1. **Refs:** generated by `snapshot`, pinned to actual elements, and invalidated by a new snapshot, navigation or a tab change. Detached/replaced elements return `stale_ref`; duplicate labels do not silently retarget a ref after DOM reordering. Take a fresh snapshot after page changes. Refs are intentionally scoped to one live viewer and cannot be guessed/reused across restarts.
2. **Selectors:** commands accept Playwright selectors as an alternative to refs, e.g. `'#submit'` or `'input[name=email]'`. Commands target the active tab's main frame.
3. **Results:** add `--json` for `{ "ok": true, "result": ... }` or `{ "ok": false, "error": { "code": ..., "message": ... } }`. Failures exit with status 1. Snapshots include a structured `refs` array alongside the readable tree.
4. **Timeouts:** `--timeout MS` defaults to 10000 and accepts 1–30000. Agent waits do not block terminal input. Other commands share the viewer's action queue. A failed command leaves the viewer running.
5. **Lifecycle:** control uses a private local socket under the session directory (a short owner-only runtime directory is used when the path is too long). It is removed when the viewer exits. Agent attachment does not take the profile lock or open a second browser.

Test the complete two-process workflow:

```fish
npm run test:agent
npm run test:herdr
```

The tests drive a named viewer from independent CLI processes, verify terminal/browser pixel parity, exercise stale/duplicate refs and tab switching, mix agent waits with human terminal input, and check endpoint cleanup. The HerdR suite also verifies agent-driven changes in the real multiplexer’s outer image stream.

## 2. Reuse Chromium

Discovery checks the matching Playwright installation, common system Chrome/Chromium/Edge locations, PATH and cached Playwright versions. Unnamed launches use an isolated temporary browser context. Named launches use their own persistent profile; existing personal Chrome profiles are not opened.

```fish
node dist/cli.js App.tsx --no-install
node dist/cli.js App.tsx --chromium '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
node dist/cli.js App.tsx --cdp http://127.0.0.1:9222
```

`REACT_KITTY_CHROMIUM` also selects a binary. `--cdp` attaches to an explicitly supplied Chromium debugging endpoint, creates its own context, and closes only that context on exit. It leaves the external browser running. It does not scan for or take over arbitrary running browsers.

If no executable exists, the default behavior installs Playwright Chromium once. `--no-install` prevents that. To install explicitly:

```fish
node dist/cli.js --install-browser
```

Linux hosts still need Chromium's OS libraries. This CLI does not install OS packages.

## 3. Input and display

| Input | Behavior |
| --- | --- |
| Click, move, drag, double/triple click | Chromium mouse events |
| Wheel / horizontal wheel | Scroll the element under the pointer |
| Text, Enter, Tab, Shift+Tab, arrows, editing keys | Chromium keyboard events |
| Enhanced Kitty keys | Modifiers, repeat and release events |
| Bracketed paste | Inserts the complete UTF-8 text, including newlines |
| Terminal resize | Resizes the desktop CSS viewport |
| Alt+Left / Alt+Right | Browser back / forward |
| Ctrl+R / Command+R / F5 | Reload active page |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+W / Command+W | Close active tab |
| Ctrl+Q | Exit and restore terminal modes |

On macOS, Chromium uses macOS editing conventions (for example, Command+A selects all). Terminal-reserved shortcuts may never reach the application. Legacy keyboard protocols cannot express every key combination or key release.

`--mobile` selects a 390 × 844 CSS-pixel viewport, mobile user agent and touch support. Mouse down/move/up become one-finger touch start/move/end. Mobile output fits the available terminal cells without stretching across the full window; unused space is on the right/bottom. `--width` and `--height` customize that viewport.

Terminal cell/pixel dimensions and pixel mouse support are queried. SGR cell mouse coordinates are the fallback. Use `--cell-width 8 --cell-height 16` to override fallback dimensions when your terminal omits geometry replies. A positive Kitty graphics query is required unless `--force` is given. Run directly in the terminal; tmux passthrough is not implemented.

`--fps 15` caps outgoing frame rate (range 1–60). Chromium streams compositor PNGs; the CLI keeps the newest frame, skips identical images, chunks base64 into 4096-byte Kitty packets, and respects stdout backpressure. It alternates two image IDs, deletes the old image after replacement, and uses synchronized terminal output.

### Current boundaries

1. This is a page viewport, not complete browser chrome: downloads, file pickers, browser permission prompts and OS-native popup surfaces aren't integrated. JavaScript dialogs are dismissed so they cannot freeze the terminal. In-page React dialogs work normally; native select controls can be operated with keyboard input.
2. Pasting from the terminal works. Automatic synchronization with the OS clipboard, IME composition sessions, accessibility text and screen-reader semantics are not transported in the raster image.
3. Mobile mode emulates one touch point. Pinch/multitouch and physical mobile terminal clients are not verified. Support depends on the events the terminal sends.
4. Native terminal compositing still needs visual verification on this machine: macOS Screen Recording access is disabled. The PTY suite proves input behavior and lossless PNG transport, not every terminal emulator's compositing implementation.

## 4. Test and inspect

```fish
npm run check
```

1. Typecheck and protocol tests cover byte-fragmented UTF-8/escape sequences, paste, key releases, mouse coordinates, graphics chunking and browser discovery.
2. A real `node-pty` process launches the **built CLI**. An independent receiver answers terminal queries and reconstructs Kitty PNGs. A separate Playwright connection asserts UI outcomes and compares decoded pixels against browser screenshots.
3. Journeys cover all entry formats, URL mode, mouse/keyboard/Unicode input, checkbox and slider dragging, wheel, resize, compile/runtime errors and recovery, mobile touch and text, cell mouse fallback, external-browser ownership, unchanged HTML asset loading, forms, links, history, reload, popup/tab switching, HTML edits, mobile HTML, and HTTP redirects.
4. Each run produces `artifacts/<timestamp>/index.html`, `report.md`, reference/terminal PNG pairs and a terminal transcript. Failures retain screenshot/HTML evidence. The suite uses an existing browser and never downloads one.
5. `npm run test:sessions` runs separate named CLI/browser processes to prove restart persistence, stable local origins, profile isolation, tab restoration, concurrent-use rejection, listing and deletion. It uses a temporary session store.
6. `node-pty` is **test-only**. The pretest script restores execute permission on its macOS prebuilt spawn helper if the npm artifact arrives without it.

An optional public-network smoke checks an external HTTPS page (use a stable page with an `h1`):

```fish
env REACT_KITTY_WEB_SMOKE=https://example.com npm run test:e2e
```

To test the **actual HerdR process inside a PTY**, including emitted Kitty pixels, image placement, outer-terminal clicks, resize, and the Example Domain link at 21×48-pixel cell size:

```fish
npm run test:herdr
```

Set `REACT_KITTY_WEB_SMOKE=https://example.com` when running this command to also click the live Learn more link through HerdR and follow its IANA redirect.

This requires `herdr` on PATH (and `python3` for the high-DPI PTY ioctl fixture), creates and removes an isolated named HerdR session with graphics enabled, and opens no native terminal windows. It decodes HerdR's outer-terminal image packets and compares them with Chromium without pre-seeding host dimensions. It also reproduces starting a client with graphics disabled and then reloading the enabled config, proving the old-client limitation. The PTY suite also accepts and declines the configuration prompt and verifies reload/backup behavior. Unit tests cover delayed capability replies, format-preserving TOML edits and concurrent edit protection. The ordinary PTY tests explicitly clear inherited HerdR pane variables so they cannot accidentally target an existing user pane.

For a real Ghostty window screenshot on macOS:

```fish
npm run test:native
```

This checks Screen Recording access before opening a window. With access enabled, it launches the app and saves `artifacts/native/ghostty.png` for visual review. It leaves the window open for manual input testing. This is explicitly separate from the automated pixel-parity gate.

## 5. Design and provenance

```text
Agent edits App.tsx ── esbuild watch ── loopback HTTP + reload events
                                              │
                                              ▼
Terminal input ── streaming parser ── Chromium page / CDP
      ▲                                       │
      └──── Kitty PNG transport ◀── compositor screencast
```

The implementation is original. Research used public descriptions of [terminal-browser](https://github.com/zenbu-labs/terminal-browser), the official [Kitty graphics](https://sw.kovidgoyal.net/kitty/graphics-protocol/) and [keyboard](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) specifications, and browser/build APIs. No implementation source from terminal-browser was copied or used as a template. The input boundary also follows the renderer-owned event model used by [dino-dna/react-tui](https://github.com/dino-dna/react-tui/blob/main/src/components/util/eventHandlers.ts): terminal transports preserve coordinates, while Chromium owns DOM hit testing and default link behavior. Its Blessed widget renderer is a different rendering backend; no code from it was copied.

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Arguments and help |
| `src/server.ts` | In-memory React bundling, assets, reload/error overlays |
| `src/target.ts` | File/URL detection and source selection |
| `src/html.ts` | Unmodified HTML/static assets, document root and file watching |
| `src/page-view.ts` | Active tab, popup handling, navigation and compositor stream |
| `src/browser.ts` | Installed browser discovery, optional download, CDP attach |
| `src/input.ts` | Incremental terminal input decoding |
| `src/interaction.ts` | Browser keyboard, mouse and touch dispatch |
| `src/herdr.ts` | HerdR capability checks and owned pane-graphics stream |
| `src/herdr-setup.ts` | Interactive config update, backup and reload |
| `src/kitty.ts` | Graphics transport and viewport geometry |
| `src/agent/` | Agent CLI, private IPC, live commands and snapshot refs |
| `src/session.ts` | Terminal/browser lifecycle, persistence orchestration and frame loop |
| `src/sessions.ts` | Named profile store, metadata, cookie snapshots and exclusive locks |
