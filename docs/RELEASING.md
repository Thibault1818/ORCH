# Releasing

The release command creates artifacts only. It never commits, tags, pushes, publishes, or modifies the source checkout.

## Preconditions

- Use the repository's supported Node.js version and npm.
- Start from the exact reviewed commit with no tracked, staged, or untracked changes.
- Ensure `package.json`, both root versions in `npm-shrinkwrap.json`, and `src/bin/cli.ts` already report the same current version.
- Choose an absolute empty output directory outside the repository.

## Build

```bash
./scripts/release.sh /absolute/path/to/release-output
```

The release version must already be committed consistently in the package, shrinkwrap, and CLI. The script creates two independent `git archive HEAD` trees, runs `npm ci --ignore-scripts`, performs clean distribution builds, and runs `npm pack` on each tree.

The release succeeds only when both clean builds produce identical sorted distribution manifests, package manifests, and byte-identical tarballs. The output contains:

- The exact npm tarball.
- `dist-manifest.tsv`: path, mode, SHA-256, and size for every regular file under `dist`.
- `package-manifest.tsv`: path, mode, SHA-256, and size for every regular file in the actual tarball, checked against `npm pack --json`.
- `SHA256SUMS`: the tarball SHA-256.

Review and retain all four outputs together. Publishing, tagging, and pushing are deliberately separate, out-of-scope operations.
