# Security policy

## Report privately

Email **security@archastro.ai** with the affected version or commit, OS, terminal,
reproduction steps, and impact. Please do not post vulnerabilities or credentials
in public issues. When enabled, you can also use
[GitHub private vulnerability reporting](https://github.com/ArchAstro/archbrowse/security/advisories/new).

Security fixes target the latest version on `main`; older versions do not have a
separate maintenance commitment.

## Trust and local data

- ArchBrowse renders real websites and executes their JavaScript in Chromium.
  Sites can contact network services as in a browser. Local React projects and
  their dependencies must be trusted; this is a preview tool, not an isolation
  service for hostile code. Keep Chromium updated. Browser launch currently uses
  Playwright's defaults, which do not enable Chromium's sandbox.
- Local preview HTTP servers listen on `127.0.0.1`. HTML mode serves files within
  its document root, including files other than the entry page. Choose a narrow
  `--root` and do not expose preview ports or CDP endpoints to untrusted networks.
- Named profiles persist cookies, localStorage, IndexedDB, and URLs. Treat session
  directories as credentials. Defaults live under `~/.local/share/archbrowse`,
  with XDG/environment overrides and compatibility with older profile locations.
- Agent control can read page content, evaluate page JavaScript, and interact
  with logged-in sites. On Unix, sockets and their directories are owner-only;
  other processes running as your user can drive the session. Session names are
  identifiers, not authentication secrets. Windows named-pipe behavior has not
  been covered by the current Linux/macOS CI matrix.
- Screenshots, terminal transcripts, page snapshots, and test artifacts may
  contain sensitive content. Review them before sharing. The standard CI tests
  use local fixtures; external-site smoke tests are opt-in.

ArchBrowse has no application telemetry or hosted control service. Websites,
browser downloads, npm/GitHub installation, and any agent provider you use have
their own network behavior and data policies.
