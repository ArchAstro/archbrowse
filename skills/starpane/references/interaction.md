# Agent workflow

Use `starpane --help` for current commands. Every action explicitly names its live session. The viewer stays running in its terminal; commands from the agent operate the same page and do not spawn a second browser.

```sh
starpane --session NAME attach --json
starpane --session NAME snapshot -i --json
starpane --session NAME get url
starpane --session NAME read
```

The snapshot includes `tree` and `refs`, each ref carrying its role and accessible name. Use those exact refs. They are invalidated by a new snapshot, navigation, tab changes or element replacement; request another snapshot on `stale_ref`.

```sh
starpane --session NAME fill REF "Ada"
starpane --session NAME click REF
starpane --session NAME press Enter
starpane --session NAME check REF
starpane --session NAME select REF option-value
starpane --session NAME wait --text "Saved"
starpane --session NAME wait --url '**/dashboard'
starpane --session NAME snapshot -i
```

Prefer product conditions over sleeping or `networkidle` (which is not a Starpane wait option). `--timeout MS` is 1–30000, default 10000. Waits do not prevent human terminal input.

```sh
starpane --session NAME get text REF
starpane --session NAME get value REF
starpane --session NAME get attr REF href
starpane --session NAME screenshot /tmp/starpane-page.png
starpane --session NAME screenshot /tmp/starpane-full.png --full
starpane --session NAME open https://example.com
starpane --session NAME back
starpane --session NAME tab list
starpane --session NAME tab t1
```

Tab IDs are discovered from `tab list`. Snapshot refs and tab IDs must not be guessed from prior sessions. Commands currently target the active tab's main frame. Use `eval` for a deliberate page-side query when a regular command does not provide the needed information, not as a replacement for browser click/fill semantics.

JSON commands return `ok: true` plus `result`, or `ok: false` plus `error.code`/`error.message`; failures exit nonzero. `session_not_running` means no live endpoint: check whether the viewer failed or is an older CLI before creating another pane. For a page load or renderer failure, inspect the viewer's terminal output. Never treat a successful `attach` as proof of the requested final page state.

Human clicks and agent actions share state. Avoid changing tabs or navigating while the human is actively editing unless the task calls for it. Leave the viewer available after completing the task; close it only when requested. A saved profile preserves cookies/localStorage/IndexedDB and URLs, not live JavaScript/React memory across exit.
