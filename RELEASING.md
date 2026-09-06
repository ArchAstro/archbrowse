# Maintainer release checklist

## Before making the repository public

1. Confirm the license, provenance, README limitations, and security policy.
2. Review all Git history, not just the working tree, for credentials and private
   material. Run `gitleaks git --redact --log-opts=--all` and `npm audit`.
   Inspect public-facing Actions logs and artifacts too. Standard tests use local
   fixtures; do not publish artifacts from private-site smoke tests.
3. Require a green CI run on the exact commit, including Linux/macOS HerdR and
   skill integration. Review the packed CLI with `npm run test:package`.
4. Obtain explicit approval to change repository visibility. Preparation does
   not itself publish the repository or an npm package.

## At public launch

1. Make `ArchAstro/archbrowse` public and verify anonymous HTTPS cloning and
   `npx skills add ArchAstro/archbrowse --skill archbrowse` discovery.
2. Enable private vulnerability reporting, secret scanning, and push protection
   in GitHub settings. Dependabot alerts and security updates should be enabled.
   These features may be unavailable while the repository is private. Verify
   them after the visibility change; do not assume an API request succeeded.
3. Protect `main`: require pull requests and the three Node/OS CI checks,
   conversation resolution, and block force-pushes/deletion. Configure maintainer
   bypass deliberately rather than accidentally locking out release maintenance.
4. Remove the conditional private-access note from the README once anonymous
   access is verified.

## Trusted npm publishing

`.github/workflows/publish.yml` publishes with GitHub OIDC and provenance; no
`NPM_TOKEN` secret is used. It accepts `vX.Y.Z` tags whose commit is contained in
`main` and whose version matches both package files. The full reusable CI matrix,
including HerdR and skill tests, must pass before publication. Stable versions
use `latest`; prereleases use `next`.

The npm package must trust this exact identity:

| Setting | Value |
| --- | --- |
| Package | `@archastro/archbrowse` |
| Provider | GitHub Actions |
| Repository | `ArchAstro/archbrowse` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty |
| Allowed action | `npm publish` |

One-time setup with npm 11.15+ (requires a maintainer login and interactive 2FA):

```fish
npm trust github @archastro/archbrowse --repo ArchAstro/archbrowse --file publish.yml --allow-publish --yes --registry=https://registry.npmjs.org
npm trust list @archastro/archbrowse --registry=https://registry.npmjs.org
```

The same fields are available in the package's npm settings under Trusted
Publishing. See [npm's trust CLI documentation](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

### Validate without publishing

```fish
gh workflow run publish.yml --ref main -f dry_run=true
```

This runs the full tests, packs the CLI, and dry-runs publication. The disposable
checkout uses a run-specific `-dryrun` prerelease version because npm rejects
already-published versions even during a dry run. No version change is committed.
A dry run does
not prove that npm accepted an OIDC token; the next actual release verifies that
exchange. Version 0.1.0 has already been published manually and cannot be reused.

### Release a new version

From a clean, up-to-date `main` checkout, choose the intended version, for example:

```fish
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release ArchBrowse patch version"
git push origin main
set release_version (node -p 'require("./package.json").version')
git tag "v$release_version"
git push origin "v$release_version"
```

Pushing the tag triggers tests and publication. If using a protected branch,
merge the version change through a pull request before tagging the merged commit.
For a failed run, fix the cause before rerunning; never move a published release
tag. A manual dispatch with `dry_run=false` must run on the matching tag:

```fish
gh workflow run publish.yml --ref "v$release_version" -f dry_run=false
```

Tags created by `GITHUB_TOKEN` do not trigger another workflow automatically;
release automation must explicitly dispatch the publish workflow on the tag.
After publication, verify the version and provenance on npm and install from an
empty directory. Public registry commands may need an explicit registry override
if your personal npm configuration sends the `@archastro` scope to GitHub Packages.
