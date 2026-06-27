#!/usr/bin/env bash
set -euo pipefail

BUMP=${1:-patch}

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: npm run release [-- patch|minor|major]  (default: patch)"
  exit 1
fi

# Must be in the kanecta-lib directory
cd "$(dirname "$0")/.."

echo "==> Checking for uncommitted changes..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: uncommitted changes detected. Commit or stash them first."
  exit 1
fi

echo "==> Checking npm auth..."
if ! npm whoami &>/dev/null; then
  echo "Error: not logged in to npm. Run: npm login"
  exit 1
fi

echo "==> Running tests..."
npm test

echo "==> Bumping $BUMP version..."
npm version "$BUMP" --message "chore(kanecta-lib): release v%s"

echo "==> Publishing to npm..."
npm publish --access public

echo "==> Pushing commit and tag to git remote..."
git push --follow-tags

NEW_VERSION=$(node -p "require('./package.json').version")
echo ""
echo "Released kanecta-lib v$NEW_VERSION"
