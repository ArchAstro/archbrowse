# Contributing to ArchBrowse

ArchBrowse is maintained by ArchAstro. Bug reports, documentation improvements,
and focused pull requests are welcome. Discuss substantial changes in an issue
before implementation.

## Develop

Use Node.js 22+, npm, Git, and Chromium. Commands below work in Fish.

```fish
git clone https://github.com/ArchAstro/archbrowse.git
cd archbrowse
npm ci
npm run build
node dist/cli.js examples/App.tsx
```

The viewer needs Kitty graphics support. Headless tests emulate the terminal in
a real PTY and do not need a GUI terminal window. If no browser is installed:

```fish
node node_modules/playwright-core/cli.js install --with-deps chromium
```

## Verify

```fish
npm run check
npm run test:package
git diff --check
```

CI runs Node 22/24 on Linux and Node 22 on macOS. Node 22 jobs also run real
HerdR 0.8.2 tests. To run those locally, install HerdR and Python 3, then:

```fish
npm run test:herdr
node skills/archbrowse/scripts/bootstrap.mjs install --source .
npm run test:skill
```

Tests create isolated sessions and write reports, screenshots, and transcripts
under ignored `artifacts/`. Inspect those when a check fails. Do not weaken pixel
or input assertions to hide a failure. `test:native` is an optional macOS visual
check requiring Screen Recording permission; automated tests open no native windows.

## Submit a change

1. Explain the problem, resulting behavior, and how you verified it.
2. Keep changes focused. Add regression coverage for behavior changes and update
   usage docs when commands or compatibility change.
3. Never include browser profiles, cookies, credentials, personal preferences,
   or unreviewed page screenshots/logs. See [SECURITY.md](SECURITY.md).
4. Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are provided
   under the repository's [MIT license](LICENSE).

The README documents current limitations, including tmux rendering and mobile
input. Avoid claiming support based only on unit tests; terminal transports need
real PTY integration coverage.
