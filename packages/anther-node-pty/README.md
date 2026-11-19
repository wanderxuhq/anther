# @wanderxuhq/anther-node-pty

Windows-only loader for [`node-pty`](https://github.com/microsoft/node-pty), used by
[anther](https://www.npmjs.com/package/@wanderxuhq/anther) for native PowerShell / cmd
terminals (ConPTY).

The package itself contains no native code. It exists so anther can declare it in
`optionalDependencies` while keeping Linux/macOS installs free of node-pty and its
build toolchain: the `os: ["win32"]` and `cpu: ["x64", "arm64"]` fields make npm skip
it on other platforms.

## Publish

```sh
cd packages/anther-node-pty
npm publish --access public
```

The `node-pty` version is pinned to the prebuilt Windows release; bump both together.

## Local testing (before publishing)

```powershell
cd packages/anther-node-pty
npm install

# Make it resolvable from the anther checkout (Windows junction):
New-Item -ItemType Directory -Force ..\..\node_modules\@wanderxuhq
New-Item -ItemType Junction `
  -Path ..\..\node_modules\@wanderxuhq\anther-node-pty `
  -Target (Get-Location)
```

Then `npm run dev` in the repository root and create a terminal. After publishing the
package, `npm install` in the root resolves the optional dependency normally and the
junction is no longer needed.
