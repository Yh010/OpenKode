# npm releases

Use the **npm release** workflow in GitHub Actions, on `main`. It builds one
archive, runs the tests on Windows and macOS, and installs that same archive in
separate temporary folders on both systems. No real model API key is needed.
Nothing publishes on a push or pull request.

## Validate

Run the workflow with `action: validate`. The `npm-package` artifact contains the
distributable. The two `package-test-*` artifacts record the archive's hash and
installation checks. All jobs must pass before staging or publishing.

## First release

The npm account owner must create a short-lived granular npm token with permission
to create this package, using **Read and write (stage only)**. Store it directly in
the repository's Actions secrets as `NPM_TOKEN`. Do not paste it into chat, code,
workflow inputs or logs. Because the unscoped package does not yet exist, npm may
require access to all packages for this first token. Revoke it after setup.

Run the workflow with `action: stage`. npm uploads the tested archive and reserves
the package name. On npmjs.com, review the staged `openkode` version and approve
it. npm requires the account owner to complete two-factor authentication for this
approval. Staging alone does not make the CLI version available to install.
After approving the first release, run the workflow with `action: verify-public`
to test installation from the public registry on Windows and macOS.

## Following releases

After the package exists, configure its npm **Trusted Publisher**:

- Provider: GitHub Actions
- Organization or user: `Yh010`
- Repository: `OpenKode`
- Workflow filename: `npm-release.yml`
- Environment: leave empty (this workflow does not use a GitHub environment)
- Allow direct `npm publish`

Run a release within npm's initial validation window for this configuration.
Use a new version in `packages/cli/package.json` for every release. Run the
workflow with `action: publish`. This uses GitHub's short-lived identity and
does not pass `NPM_TOKEN` to the publish step.
After publishing, the workflow installs the public version from npm outside the
checkout on Windows and macOS and checks its version and help command.

Revoke the first-release token in npm and remove the `NPM_TOKEN` GitHub secret
after it is no longer needed. Never reuse a published or pending staged version.

## Check public installation

After approval or publishing, verify from an allowed network on Windows or macOS:

```sh
npm view openkode version --registry=https://registry.npmjs.org/
npm install -g openkode --registry=https://registry.npmjs.org/
openkode --version
openkode --help
```

The operator's dashboard and collector are separate hosted services and are not
part of this npm release.

References: [npm staged publishing](https://docs.npmjs.com/cli/v11/commands/npm-stage/),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
