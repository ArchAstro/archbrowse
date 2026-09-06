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

## npm publication is a separate step

No npm release is assumed by the source install or bundled skill. Before the
first publication, verify ownership of the `@archastro/archbrowse` npm name,
choose a version, and configure a GitHub Actions trusted publisher with npm
provenance. Use `https://registry.npmjs.org` and public package access; a personal
`@archastro` scope override can otherwise direct installation to GitHub Packages.

Build and test from a clean checkout. Inspect the archive from `npm pack`,
including `LICENSE`, the CLI, examples, and skill. Publish only with explicit
release authorization, tag that commit, and provide release notes describing
supported terminals and known limitations. Verify installation from an empty
directory before adding npm installation instructions to the README.
