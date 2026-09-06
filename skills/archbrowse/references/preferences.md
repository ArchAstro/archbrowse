# Saved preferences

Default file: `$XDG_CONFIG_HOME/archbrowse/preferences.json`, falling back to `~/.config/archbrowse/preferences.json`. `ARCHBROWSE_PREFERENCES_FILE` overrides the exact path. Writes are atomic and mode 0600. The helper refuses malformed data instead of resetting it.

```sh
node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" show --workspace "$ARCHBROWSE_WORKSPACE"
node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" set --host herdr --placement split --sessions workspace --focus keep
```

That command is an **example choice**, not a default for all users. Collect the user's preferences first. Omit `--workspace` when saving global defaults; supply it for a project/worktree override:

```sh
node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" set --workspace "$ARCHBROWSE_WORKSPACE" --placement tab
```

Overrides inherit the global settings. The workspace key is the canonical Git worktree root, or the canonical directory outside Git. No file is added to the user's repo.

| Flag | Values |
| --- | --- |
| `--host` | `herdr`, `terminal`, `tmux` |
| `--placement` | `split`, `tab`, `current` |
| `--sessions` | `workspace`, `fresh`, `named`, `ask` |
| `--name` | Explicit session name when policy is `named` |
| `--focus` | `keep`, `viewer` |
| `--direction` | `auto`, `right`, `down` |
| `--browser-download` | `if-missing`, `never` |
| `--terminal-program` | `manual`, `kitty`, `ghostty`, `wezterm` |
| `--mobile` / `--desktop` | Default viewport mode |

The required onboarding choices are host, placement and session policy. Optional defaults are focus `keep`, direction `auto`, browser downloads `if-missing`, desktop mode and terminal program `manual`. Change them when the user states a different preference.

For complex answers, write a JSON patch to a temporary file and pass `set --file /path/to/patch.json`; do not interpolate free-form JSON into shell code. JSON keys are `host`, `placement`, `sessionPolicy`, `sessionName`, `focus`, `splitDirection`, `browserDownload`, `terminalProgram`, `mobile`.

```json
{
  "version": 1,
  "defaults": {
    "host": "herdr",
    "placement": "split",
    "sessionPolicy": "workspace",
    "focus": "keep",
    "splitDirection": "auto",
    "browserDownload": "if-missing",
    "terminalProgram": "manual",
    "mobile": false
  },
  "workspaces": {}
}
```

## Planning and one-off requests

```sh
node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" plan --workspace "$ARCHBROWSE_WORKSPACE"
node "$ARCHBROWSE_SKILL_DIR/scripts/preferences.mjs" plan --workspace "$ARCHBROWSE_WORKSPACE" --sessions fresh
```

`plan` never saves changes. Its `settings` apply to this launch, while `set` changes future preferences.

- `workspace` computes a stable session name from the HerdR session socket + workspace ID when in HerdR, otherwise the canonical worktree path. Different workspaces do not accidentally share cookies or page control.
- `fresh` produces a unique name. Keep that returned name for the entire task; do not rerun the planner before every command.
- `named` uses the exact saved/provided name.
- `ask` returns `needs-session-choice`. Collect the choice and rerun with `--sessions workspace`, `--sessions fresh`, or `--sessions named --name NAME`.

The helper saves tmux preferences but returns `unsupported-host` for a tmux viewer. Choosing a supported host with a one-off plan does not erase the user's preference.
