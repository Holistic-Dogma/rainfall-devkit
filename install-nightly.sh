#!/bin/bash

# Rainfall Devkit - Nightly Build Installer
# Installs the latest version directly from GitHub releases or a local
# tarball. Resolves the latest version dynamically (gh release list →
# GitHub REST API → package.json) so the installer always pulls the
# freshest release instead of a pinned (and stale) tag.
#
# Override with VERSION=X.Y.Z to pin a specific release.

set -e

REPO="Holistic-Dogma/rainfall-devkit"
INSTALL_DIR=$(pwd)

# Resolve the latest version with a graceful fallback chain.
#   1. `gh release list --limit 1`           (preferred; no auth for public repos)
#   2. GitHub REST /releases/latest           (works without `gh` installed)
#   3. package.json "version" field           (offline, last-resort)
# Returns the bare version (no leading "v").
resolve_latest_version() {
  local version=""

  # 1) `gh` CLI — fastest, no auth required for public repos
  if command -v gh >/dev/null 2>&1; then
    version=$(gh release list --repo "$REPO" --limit 1 \
              --json tagName --jq '.[0].tagName // empty' 2>/dev/null) || version=""
  fi

  # 2) GitHub REST API
  if [ -z "$version" ] && command -v curl >/dev/null 2>&1; then
    local tag=""
    tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null) || tag=""
    if [ -n "$tag" ]; then
      version=$(printf '%s' "$tag" \
        | (command -v jq >/dev/null 2>&1 && jq -r '.tag_name // empty' \
           || python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("tag_name", ""))
except Exception:
    pass'))
    fi
  fi

  # 3) Local package.json (offline fallback)
  if [ -z "$version" ] && [ -f "package.json" ]; then
    if command -v python3 >/dev/null 2>&1; then
      version=$(python3 -c 'import json; print(json.load(open("package.json")).get("version", ""))' 2>/dev/null) || version=""
    elif command -v jq >/dev/null 2>&1; then
      version=$(jq -r '.version // empty' package.json 2>/dev/null) || version=""
    fi
  fi

  printf '%s' "$version"
}

VERSION="${VERSION:-$(resolve_latest_version)}"
# Strip leading "v" if present (gh release list and the API both include it).
VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
  echo "❌  Could not resolve the latest version from any source:" >&2
  echo "    1) gh release list --repo ${REPO} --limit 1" >&2
  echo "    2) https://api.github.com/repos/${REPO}/releases/latest" >&2
  echo "    3) ./package.json (the \"version\" field)" >&2
  echo "" >&2
  echo "   Pin a version explicitly: VERSION=0.2.21 ./install-nightly.sh" >&2
  exit 1
fi

PACKAGE_NAME="rainfall-devkit-sdk-${VERSION}.tgz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${PACKAGE_NAME}"

echo "🌧️  Installing Rainfall Devkit v${VERSION} (Nightly Build)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if tarball exists locally
if [ -f "${INSTALL_DIR}/${PACKAGE_NAME}" ]; then
    echo "📦 Found local tarball: ${PACKAGE_NAME}"
    echo "🔧 Installing from local file..."
    npm install -g "${INSTALL_DIR}/${PACKAGE_NAME}"
else
    echo "📥 Downloading from GitHub releases..."
    curl -L "${DOWNLOAD_URL}" -o "${INSTALL_DIR}/${PACKAGE_NAME}"
    echo "🔧 Installing..."
    npm install -g "${INSTALL_DIR}/${PACKAGE_NAME}"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Installation complete!"
echo ""
echo "🚀 Get started:"
echo "   rainfall --help"
echo "   rainfall agent list"
echo "   rainfall agent chat 'hello, who are you?'"
echo ""
echo "📚 Documentation: https://rainfall-devkit.com/docs"
