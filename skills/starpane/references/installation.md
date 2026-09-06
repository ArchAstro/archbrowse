# Installation

The bootstrap helper is idempotent and uses user-local paths. Node.js 22+ and npm are prerequisites. If Node is missing, use the user's existing runtime manager or ask how they want Node installed; do not silently replace their runtime setup.

```sh
node "$STARPANE_SKILL_DIR/scripts/bootstrap.mjs" status
node "$STARPANE_SKILL_DIR/scripts/bootstrap.mjs" install
```

When a source checkout was supplied:

```sh
node "$STARPANE_SKILL_DIR/scripts/bootstrap.mjs" install --source "$STARPANE_WORKSPACE"
```

`--source` must be the **Starpane** checkout, not the app being previewed. Omit it for ordinary app work.

The helper:

1. Reuses a verified Starpane CLI from PATH or its managed installation.
2. Uses an enclosing Starpane checkout when the skill lives in the repo. Otherwise it fetches `calvin-archastro/starpane` with `gh repo clone`. The repository is currently private: authenticated access is required. Stop at an authentication/access failure and explain it; do not switch to an unrelated npm package.
3. Builds the source, packs it and installs production dependencies under `~/.local/share/starpane/cli` (or `$XDG_DATA_HOME/starpane/cli`). It skips dependency lifecycle scripts and does not download Chromium during installation.
4. Creates `~/.local/bin/starpane` on Unix, refusing to overwrite an unrelated file. It returns an absolute `command` vector, so the agent can proceed without editing shell startup files.

Use the returned `command` array as executable plus arguments. Do not join user input into an unescaped shell command. If needed, show the user how to add the returned bin directory to PATH with **their** shell (Fish: `fish_add_path /actual/bin/directory`). Do not repeatedly reinstall because a shell has not refreshed PATH.

Test/install overrides: `STARPANE_INSTALL_DIR` and `STARPANE_BIN_DIR`. An existing working CLI is left alone; this helper is bootstrap, not an automatic updater.

## Browser setup

Starpane discovers installed Chromium/Chrome/Edge and Playwright caches. The saved `browserDownload` preference supplies `--no-install` when downloads are unwanted. Otherwise the CLI can install Chromium if none is found. Linux system libraries may still be required; use the actual browser error to identify a missing dependency.

## Skill distribution

The skill is checked in at `skills/starpane/` and included in the npm package. `starpane --skill` prints its entrypoint. The same preference file works across Codex and other agents; do not maintain a separate copy of the user's choices for each harness.
