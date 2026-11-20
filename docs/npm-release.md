# npm releases

## Published release

`openkode@1.0.0` was published on November 20, 2026. The public `latest` tag is
`1.0.0`. Its SHA1 is `f42c03c8b1549144d5d7770646d56fe9176be710`, matching the
archive tested before upload.

- [Package on npm](https://www.npmjs.com/package/openkode)
- [Build, Windows/Mac tests and staging](https://github.com/Yh010/OpenKode/actions/runs/44741326900)
- [Public Windows/Mac installation checks](https://github.com/Yh010/OpenKode/actions/runs/44743173582)

The first public download checks returned 404 after npm reported publication;
downloads became available several minutes later, and both installation checks
passed. One earlier Windows credential test job hit its helper timeout; the
failed job passed on rerun.

## Automatic releases from main

Each push to `main`, including a merged pull request, starts the **npm release**
workflow. This includes documentation and workflow changes. One release covers
all commits included in that push. Other branches can only run validation.

1. Read npm's published versions and choose the next patch version.
2. Write that version and the full source commit (`gitHead`) into the build's
   package manifest.
3. Build one archive, run core/CLI/release tests, and install that archive in
   separate temporary directories on Windows and macOS.
4. Publish the exact tested archive through npm trusted publishing.
5. Record a `v<version>` Git tag at the source commit.
6. Install the public version outside the checkout on Windows and macOS. Check
   the installed version, the public `latest` tag, source commit and help command.

Failed build or test jobs prevent publishing. A failure after publishing (such
as public download propagation or tag creation) still reports a failed workflow;
the already published version remains on npm. Rerun that workflow to finish its
checks. A source commit already recorded in npm's `gitHead` reuses its version
and is not published again. A registry error stops planning rather than guessing
an available version.

Releases run one at a time. GitHub queues up to 100 waiting runs in order of
arrival at the concurrency group; additional runs are subject to GitHub's queue
limit. npm is the authority for allocated release versions. Git tags and the
package's `gitHead` identify the exact source. The checkout's
`packages/cli/package.json` holds the starting version, and CI writes the chosen
version only in its working copy before building and testing. It does not push
version-only commits back to `main`. An intentional higher major/minor version
in that source manifest becomes the next release version.

## npm connection

The package's npm Trusted Publisher must use:

- Provider: GitHub Actions
- Organization or user: `Yh010`
- Repository: `OpenKode`
- Workflow filename: `npm-release.yml`
- Environment: empty (the workflow does not use a GitHub environment)
- Allow `npm publish`: enabled
- Allow `npm dist-tag`: disabled (separate tag administration is not used)

The workflow uses GitHub's short-lived identity and does not read `NPM_TOKEN`.
The first-release stage-only token can be revoked in npm and its GitHub secret
removed after switching to this connection. Account verification may be needed
when establishing the connection; regular releases do not require manual npm
approval.

## Manual recovery and validation

Run **npm release** with:

- `validate`: build and test the package without publishing. This also works on
  development branches.
- `publish`: publish a new main commit or finish a previously published commit's
  tagging and public checks. Publishing is restricted to `main`.
- `verify-public`: check the version currently served by npm's `latest` tag.

For a failed run, prefer GitHub's rerun controls on that same source commit.
Do not unpublish or reuse a released version to fix a failure.

## Users updating an installed CLI

```sh
npm install -g openkode@latest
openkode --version
```

Existing installed copies do not update themselves. Node.js 24.14 or newer and
Windows/macOS remain required. The collector and dashboard are separate hosted
services and are not deployed by this workflow.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
