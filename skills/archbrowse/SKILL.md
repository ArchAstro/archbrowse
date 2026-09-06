---
name: archbrowse
description: Install and configure ArchBrowse, open React apps, HTML files or websites in a terminal using saved layout and session preferences, and drive the live page through snapshots and refs. Use for ArchBrowse setup, headless browser sessions, terminal browser previews, or agent control of an ArchBrowse session.
---

# ArchBrowse

ArchBrowse displays Chromium pixels in a terminal and lets humans and agents control the same page. A background session can own Chromium without a terminal; visual viewers and agents attach independently. A direct viewer still owns its browser until it exits.

Resolve `scripts/` and `references/` relative to this skill directory. In examples, `ARCHBROWSE_SKILL_DIR` points here and `ARCHBROWSE_WORKSPACE` is the user's actual worktree. Set them with the caller's shell syntax; do not change the worktree just to run a helper.

Choose the lifecycle from the task: use `--headless --session NAME` for agent-only work or when a viewer should be attached later. Use the saved terminal layout when the user wants to see a page immediately. Read [background sessions](references/background.md) for headless startup, visual attachment and stop/detach semantics. Never emulate headless mode by hiding a viewer in a tool PTY.

If the user explicitly names an already-running session for agent-only control, attach directly and use **Drive the page** below. Placement onboarding is needed before creating a viewer, not before every read or click.

## First use: install and remember preferences

1. Check `node --version` (22+), then run:
   ```sh
   node "$ARCHBROWSE_SKILL_DIR/scripts/bootstrap.mjs" status
   node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" show --workspace "$ARCHBROWSE_WORKSPACE"
   ```
2. If ArchBrowse is missing, read [installation](references/installation.md) and run the bootstrap installer. Reuse installed Chromium; the CLI already discovers it. Do not guess an npm package or install a second browser unconditionally.
3. If preferences are missing, ask these questions together, using known context to recommend choices:
   - **Mode:** headless or visible terminal? An explicit headless request settles this for the current task; do not ask for terminal placement until a viewer is wanted.
   - **Where (visible mode only):** a new HerdR split, a new HerdR tab, the current compatible terminal, or another terminal setup? Ask which emulator if relevant. Record a tmux preference, but explain its unsupported rendering path and choose an available alternative for this task.
   - **Session policy:** reuse one named session per workspace, create a fresh session each time, use a specific name, or ask each time?
   - **Focus (visible mode only):** leave focus with the caller or move it to the viewer? If split direction matters, collect that too; otherwise use `auto`.
4. Save their answers with `preferences.mjs set`. [Preference storage and examples](references/preferences.md) explain global defaults, workspace overrides and one-off choices. Preferences belong in the user's config file, never in this skill or the project repository. Honor preferences already supplied in the conversation; do not ask for them again.
5. On later runs, read saved preferences and skip onboarding. A current explicit request overrides them; only update persistent preferences when the user asks to change their defaults.

## Open the viewer where the user wants it

```sh
node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" plan --workspace "$ARCHBROWSE_WORKSPACE"
```

Use the returned session name, mode, layout settings and `launchFlags` (`viewerFlags` contains only browser/mobile options). If `settings.mode` is `headless`, start the background owner from the workspace without creating a pane; follow the background-session reference. Read [launching](references/launching.md) for the selected host only.

- `ready`: proceed. For reusable sessions, try `archbrowse --session NAME attach --json` **before** creating a pane or tab. Reuse a matching live session. If it reports `mode: background` and the user wants a visual viewer, launch `attach NAME --view` in the chosen location; do not start a second owner. An inactive profile can be reopened.
- `needs-setup` / `needs-session-choice`: ask for the missing choice and rerun the plan.
- `host-unavailable`: explain which host context is missing; select an available host for this request.
- `unsupported-host`: retain the preference but do not pretend the transport works. ArchBrowse currently cannot render inside tmux; agents in tmux can still drive a live viewer elsewhere. Never use `--force` as a tmux workaround.

A saved layout preference authorizes that layout when the user asks to open a viewer. Do not ask again before each split/tab. Keep focus according to the preference. Use the bootstrap result's `command` argument vector when `archbrowse` is not on PATH.

ArchBrowse sessions and terminal panes are different objects. Reusing a profile does not mean creating another viewer with the same name: one live owner holds the profile lock. A background owner permits one visual viewer at a time, alongside agent commands. On a failed attach, distinguish `session_not_running` from other errors before starting another viewer. Verify ownership before closing/restarting a pane.

## Drive the page

Use the live CLI's `--help` for current syntax. Follow the snapshot → action → product condition → fresh snapshot loop:

```sh
archbrowse --session NAME snapshot -i --json
archbrowse --session NAME fill REF "Ada"
archbrowse --session NAME click REF
archbrowse --session NAME wait --text "Welcome"
archbrowse --session NAME snapshot -i
archbrowse --session NAME screenshot /tmp/archbrowse-result.png
```

Replace `NAME` with the planned name and `REF` with an exact ref from the latest snapshot. Prefer refs or semantic selectors over guessed coordinates. Re-snapshot after navigation, tab changes or DOM replacement; `stale_ref` is a request to inspect again, not to guess a replacement. [Interaction reference](references/interaction.md) covers reads, forms, navigation, tabs, screenshots and failure diagnosis.

Wait for page content or a successful `attach`; a live process alone is not proof of a working viewer. Report the chosen session and terminal location, and what you actually verified. Leave the viewer available unless the user requests cleanup. Ctrl+Q in an attached `--view` terminal only detaches it; the background page and JavaScript remain alive. `sessions stop NAME` saves and closes the background browser. Ctrl+Q in a direct viewer still closes its browser. Reopening a stopped browser restores durable storage/URLs, not in-memory React state.
