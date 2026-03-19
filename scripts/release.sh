#!/usr/bin/env bash
# Usage: bash scripts/release.sh 0.2.1
# Bumps version in package.json, creates git tag, pushes — triggers CI release

set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "Example: bash scripts/release.sh 0.2.1"
  exit 1
fi

# Validate CHANGELOG has entry for this version
if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  echo "❌ CHANGELOG.md has no entry for [$VERSION]"
  echo "Add ## [$VERSION] — $(date +%Y-%m-%d) section first."
  exit 1
fi

# Check working tree is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Bump version in package.json
CURRENT=$(node -p "require('./package.json').version")
echo "Bumping $CURRENT → $VERSION"
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$VERSION\"/" package.json

# Commit and tag
git add package.json
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"
git push origin main --tags

echo "✅ Released v$VERSION — CI will build binaries and publish GitHub Release"
