# Launching in the selected location

First run the preferences planner. Use its session name, workspace and viewer flags. Check `starpane --session NAME attach --json` before creating any layout when `reuse` is true. If it succeeds, work with that viewer. When the user explicitly wants it moved to another split/tab, identify its owned pane and use HerdR’s pane-move command; do not start a second viewer against the locked profile. If its URL must change, use `open URL` only as directed by the current task.

`open` cannot replace a live local TSX/HTML entry file. For a different local entry, either use a fresh session or close and restart the identified Starpane viewer in its own pane. Match the session in the pane's actual foreground argv; never send Ctrl+Q to an unrelated editor/agent or delete a profile merely to release its lock.

## HerdR

Require `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID` and `HERDR_PANE_ID`. These identify the calling workspace; do not use another client's UI-focused pane as a substitute. Saved user preferences can authorize a split or tab even when a generic HerdR workflow defaults to a sibling split.

Use the installed CLI as the syntax authority:

```sh
herdr pane layout --current
herdr pane
herdr tab
```

For `split`, honor the saved direction. With `auto`, use the caller's actual pane rectangle: split right when `width >= 2 * height`, otherwise down. Preserve the target cwd and focus preference:

```sh
herdr pane split --current --direction right --cwd "$STARPANE_WORKSPACE" --no-focus
```

For `tab`, explicitly target the calling workspace:

```sh
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$STARPANE_WORKSPACE" --label Starpane --no-focus
```

Replace `--no-focus` with `--focus` only when requested/saved. Parse the returned pane ID: split returns `result.pane.pane_id`; tab creation returns `result.root_pane.pane_id`. Do not infer IDs from tab numbers. Then use `herdr pane run PANE_ID COMMAND`, where COMMAND is a correctly shell-quoted Starpane invocation:

```text
starpane /absolute/path/App.tsx --session NAME [viewerFlags]
```

Use the bootstrap result's absolute command when PATH is not ready. Every executable/argument must be quoted for the pane's shell; never interpolate an unquoted user URL, file path or name. Herdr's pane command takes one complete command argument; prefer a tool API/argv array for invoking the `herdr` CLI itself.

Wait for `starpane --session NAME attach --json` to succeed, then snapshot and verify the requested page. If startup fails, inspect **the pane you created** with `herdr pane read PANE_ID --source recent-unwrapped --lines 40` and act on that error. Clean up an empty failed pane/tab you created; never close the caller pane or a user's other work.

Starpane can offer to enable `experimental.kitty_graphics` in HerdR. A saved host preference is not automatic consent to unrelated config edits; follow existing task authorization and the concrete CLI prompt. HerdR 0.8.2 clients started with graphics disabled still need one reattachment after enabling it. Do not stop the HerdR server or its other panes to fix a client setting.

`current` means a user-designated free terminal pane, not the pane occupied by the coding agent. If the current pane hosts the agent, ask for another placement or provide the viewer command.

## Direct terminal

Starpane needs a real Kitty-graphics terminal, such as Kitty, Ghostty or WezTerm. For `current`, run the viewer in the user-designated free terminal. A hidden tool PTY is useful for tests but is not proof that the human can see a viewer.

For a new tab/split in a named emulator, inspect its installed CLI/help and use its supported tab/split mechanism. Honor `terminalProgram`, placement and focus. Do not substitute a new native window for a requested tab, launch another emulator, or open GUI permission prompts as a fallback. If that environment cannot create the chosen layout, explain the concrete limitation and offer a supported placement for this task.

## tmux

Starpane's tmux graphics transport is not implemented. Do not launch `tmux split-window starpane ...` or use `--force` and claim it works. Keep the requested preference in the file; ask to use a supported viewer outside tmux, or attach to an already running named viewer. The agent-control commands work from a tmux shell because they use a private socket rather than rendering pixels there.
