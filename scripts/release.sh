#!/usr/bin/env bash
set -euo pipefail

# Builds the same release twice from clean HEAD archives and emits artifacts only.
# Usage: ./scripts/release.sh /absolute/output/directory

ROOT=$(git rev-parse --show-toplevel)
OUTPUT="${1:-}"
VERIFY="$ROOT/scripts/verify-release-artifacts.mjs"

if [[ -z "$OUTPUT" ]]; then
  echo "Usage: ./scripts/release.sh /absolute/output/directory" >&2
  exit 2
fi
if [[ "$OUTPUT" != /* ]]; then
  echo "Release output directory must be absolute" >&2
  exit 2
fi
case "$OUTPUT/" in
  "$ROOT/"*)
    echo "Release output directory must be outside the source repository" >&2
    exit 2
    ;;
esac
if [[ -n "$(git -C "$ROOT" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Release refused: tracked, staged, or untracked changes are present" >&2
  exit 1
fi

CURRENT=$(node "$VERIFY" versions "$ROOT")
SOURCE_DATE_EPOCH=$(git -C "$ROOT" show -s --format=%ct HEAD)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/orch-release.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/run-1" "$TMP/run-2"
git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$TMP/run-1"
git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$TMP/run-2"

build_release() {
  local source="$1"
  local result="$2"
  mkdir -p "$result"
  (
    cd "$source"
    export SOURCE_DATE_EPOCH TZ=UTC LC_ALL=C
    local version
    version=$(node -e "process.stdout.write(require('./package.json').version)")
    node scripts/verify-release-artifacts.mjs versions "$source" >/dev/null
    rm -rf dist node_modules
    npm ci --ignore-scripts
    npm run build:dist
    node scripts/verify-release-artifacts.mjs dist-manifest dist "$result/dist-manifest.tsv"
    npm pack --json --ignore-scripts --pack-destination "$result" > "$result/npm-pack.json"
    local tarball
    tarball=$(node -e "const p=require(process.argv[1])[0]; process.stdout.write(p.filename)" "$result/npm-pack.json")
    node scripts/verify-release-artifacts.mjs package-manifest "$result/$tarball" "$result/npm-pack.json" "$result/package-manifest.tsv"
    node scripts/verify-release-artifacts.mjs sha256 "$result/$tarball" > "$result/tarball.sha256"
    printf '%s\n' "$version" > "$result/version"
  )
}

build_release "$TMP/run-1" "$TMP/result-1"
build_release "$TMP/run-2" "$TMP/result-2"

VERSION=$(<"$TMP/result-1/version")
if [[ "$VERSION" != "$CURRENT" ]]; then
  echo "Release refused: clean archive version differs from committed version" >&2
  exit 1
fi
for file in version dist-manifest.tsv package-manifest.tsv tarball.sha256; do
  cmp "$TMP/result-1/$file" "$TMP/result-2/$file"
done
TARBALL=$(node -e "const p=require(process.argv[1])[0]; process.stdout.write(p.filename)" "$TMP/result-1/npm-pack.json")
cmp "$TMP/result-1/$TARBALL" "$TMP/result-2/$TARBALL"

if [[ -e "$OUTPUT" ]] && [[ -n "$(ls -A "$OUTPUT" 2>/dev/null)" ]]; then
  echo "Release output directory must not already contain files: $OUTPUT" >&2
  exit 1
fi
mkdir -p "$OUTPUT"
cp "$TMP/result-1/$TARBALL" "$OUTPUT/$TARBALL"
cp "$TMP/result-1/dist-manifest.tsv" "$OUTPUT/dist-manifest.tsv"
cp "$TMP/result-1/package-manifest.tsv" "$OUTPUT/package-manifest.tsv"
TARBALL_SHA=$(<"$TMP/result-1/tarball.sha256")
printf '%s  %s\n' "$TARBALL_SHA" "$TARBALL" > "$OUTPUT/SHA256SUMS"

printf 'Release v%s created reproducibly in %s\n' "$VERSION" "$OUTPUT"
printf 'No source files, commits, tags, remotes, or registries were changed.\n'
