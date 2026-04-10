#!/bin/bash

# Rainfall Devkit - Nightly Build Installer
# Installs the latest version directly from GitHub releases or local tarball

set -e

VERSION="0.2.18"
PACKAGE_NAME="rainfall-devkit-sdk-${VERSION}.tgz"
DOWNLOAD_URL="https://github.com/Holistic-Dogma/rainfall-devkit/releases/download/v${VERSION}/${PACKAGE_NAME}"
INSTALL_DIR=$(pwd)

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
