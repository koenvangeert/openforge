#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Open Forge"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
INSTALL_DIR="/Applications"

echo "Building ${APP_NAME}..."
pnpm tauri build

APP_PATH="${BUNDLE_DIR}/${APP_NAME}.app"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Build artifact not found at ${APP_PATH}" >&2
  exit 1
fi

# Close running instance if any
if pgrep -xq "${APP_NAME}"; then
  echo "Closing running instance..."
  osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
  sleep 1
  # Force kill if still running
  pkill -x "${APP_NAME}" 2>/dev/null || true
fi

echo "Installing to ${INSTALL_DIR}..."
rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
cp -R "$APP_PATH" "${INSTALL_DIR}/"

# Remove quarantine attribute to prevent Gatekeeper "damaged" error on unsigned builds
xattr -rd com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null || true

echo "Installed ${APP_NAME} to ${INSTALL_DIR}/${APP_NAME}.app"
