# Agent workflow

Use `archbrowse --help` for current commands. Every action explicitly names its live session. The viewer stays running in its terminal; commands from the agent operate the same page and do not spawn a second browser.

```sh
archbrowse --session NAME attach --json
archbrowse --session NAME snapshot -i --json
archbrowse --session NAME get url
archbrowse --session NAME read
```

The snapshot includes `tree` and `refs`, each ref carrying its role and accessible name. Use those exact refs. They are invalidated by a new snapshot, navigation, tab changes or element replacement; request another snapshot on `stale_ref`.

```sh
archbrowse --session NAME fill REF "Ada"
archbrowse --session NAME click REF
archbrowse --session NAME press Enter
archbrowse --session NAME check REF
archbrowse --session NAME select REF option-value
archbrowse --session NAME wait --text "Saved"
archbrowse --session NAME wait --url '**/dashboard'
archbrowse --session NAME snapshot -i
```

Prefer product conditions over sleeping or `networkidle` (which is not an ArchBrowse wait option). `--timeout MS` is 1–30000, default 10000. Waits do not prevent human terminal input.

```sh
archbrowse --session NAME get text REF
archbrowse --session NAME get value REF
archbrowse --session NAME get attr REF href
archbrowse --session NAME screenshot /tmp/archbrowse-page.png
archbrowse --session NAME screenshot /tmp/archbrowse-full.png --full
archbrowse --session NAME open https://example.com
archbrowse --session NAME back
archbrowse --session NAME tab list
archbrowse --session NAME tab t1
```

Tab IDs are discovered from `tab list`. Snapshot refs and tab IDs must not be guessed from prior sessions. Commands currently target the active tab's main frame. Use `eval` for a deliberate page-side query when a regular command does not provide the needed information, not as a replacement for browser click/fill semantics.

JSON commands return `ok: true` plus `result`, or `ok: false` plus `error.code`/`error.message`; failures exit nonzero. `session_not_running` means no live endpoint: check whether the viewer failed or is an older CLI before creating another pane. For a page load or renderer failure, inspect the viewer's terminal output. Never treat a successful `attach` as proof of the requested final page state.

Human clicks and agent actions share state. Avoid changing tabs or navigating while the human is actively editing unless the task calls for it. Leave the viewer available after completing the task; close it only when requested. A saved profile preserves cookies/localStorage/IndexedDB and URLs, not live JavaScript/React memory across exit.
