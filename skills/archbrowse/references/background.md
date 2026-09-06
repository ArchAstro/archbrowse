# Headless sessions and detachable viewers

Use a background owner when the agent needs a browser without displaying it, or
when the user wants to attach a terminal later. Check the installed CLI's `--help`
for `--headless` and `--view`; older releases need the bootstrap upgrade described
in [installation](installation.md). Use its returned command vector.

## Start and drive

```sh
archbrowse /absolute/path/App.tsx --session NAME --headless --no-install
archbrowse --session NAME attach --json
archbrowse --session NAME snapshot -i --json
archbrowse --session NAME click REF
```

The starter returns only after the background owner is ready. It needs no TTY,
HerdR or tmux graphics and survives the launching CLI's exit. Websites, HTML and
React entries use the same source handling and live reload as direct viewers.
Omit `--no-install` only when browser downloads are allowed by the user's choice.
Desktop defaults to 1280×720; `--width`/`--height` set the initial viewport.
`--mobile` defaults to 390×844 with touch emulation.

Reuse the returned session name. On repeat requests, inspect with `attach --json`
before starting: starting the same active name fails rather than replacing its
page. To change an active website, use the agent `open` command. Choosing another
local entry requires another session or deliberately stopping/restarting this one.

## Attach a visual terminal later

```sh
archbrowse attach NAME --view
```

Use the saved host/placement/focus preferences and the commands in
[launching](launching.md). Create the selected HerdR pane/tab and run this attach
command inside it. If headless onboarding never collected a visible layout, ask
for that choice now. Do not substitute a hidden tool PTY for a human-visible
terminal. Keep the existing background session name when planning a layout.

`attach NAME` without `--view` only inspects metadata. `--view` joins the same live
page: it does not open another browser, reload the page or acquire its profile
lock. One viewer may attach at a time. `viewer_busy` means another visual viewer
is connected; leave it alone unless the user asks to replace it. Agents can keep
controlling the page while a viewer is attached.

A desktop viewer sets the page viewport to its terminal size; mobile keeps its
fixed emulated viewport. A detach leaves the last viewport in place. Input and
resize requests are serialized with agent actions.

## Detach versus stop

- Ctrl+Q, closing the attached terminal, or losing that viewer disconnects it.
  The background browser, tabs, JavaScript state and agent endpoint remain live.
- `archbrowse sessions stop NAME` explicitly closes the owner, saves durable
  profile data, disconnects viewers and releases the session lock.
- To reopen a stopped profile: `archbrowse --session NAME --headless`.
  Cookies/localStorage/IndexedDB and URLs persist, but live JavaScript does not
  survive stopping the browser or restarting the machine.
- Direct viewers launched without `--headless` keep their existing lifecycle:
  Ctrl+Q closes their browser, and they cannot be joined with `--view`.

Background logs live at `SESSIONS_DIR/NAME/background.log`; session storage uses
the same XDG/default/legacy paths as ordinary profiles. Logs may contain private
page errors or paths. Inspect failures locally and review before sharing.

Use `sessions list --json` to check active/saved state and `attach --json` for
`mode`, owner PID and `viewerAttached`. Do not signal an arbitrary PID from stale
metadata; stop through the session command. After a hard owner crash, the existing
profile lock may take about ten seconds to become stale before restart succeeds.
