#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/openforge-cli-install.sh
. "${SCRIPT_DIR}/openforge-cli-install.sh"

APP_NAME="Open Forge"
INSTALL_DIR="/Applications"

report_failure() {
  local phase="$1"
  local severity="$2"
  local decision="$3"
  local user_message="$4"
  local remediation="$5"
  local cause="$6"

  echo "[electron:failure] ${severity} ${phase}: ${user_message}" >&2
  echo "Cause: ${cause}" >&2
  echo "Remediation: ${remediation}" >&2
  echo "Decision: ${decision}" >&2
}

stop_running_app() {
  if pgrep -xq "${APP_NAME}"; then
    echo "Closing running instance..."
    osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
    sleep 1
    pkill -x "${APP_NAME}" 2>/dev/null || true
  fi

  if pgrep -fq 'Open Forge.app/Contents/MacOS/openforge-sidecar'; then
    report_failure \
      "install:stale-sidecar-cleanup" \
      "warning" \
      "continue" \
      "A stale OpenForge sidecar is still running during install." \
      "The installer will try to stop the stale sidecar before replacing the app bundle." \
      "pgrep matched Open Forge.app/Contents/MacOS/openforge-sidecar"
    echo "Stopping stale Electron sidecar..."
    pkill -f 'Open Forge.app/Contents/MacOS/openforge-sidecar' 2>/dev/null || true
  fi
}

echo "Building Electron ${APP_NAME}..."
pnpm electron:package

APP_PATH="$(node scripts/rust-sidecar-layout.mjs electron-app-path)"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Build artifact not found at ${APP_PATH}" >&2
  exit 1
fi

stop_running_app

echo "Installing Electron app to ${INSTALL_DIR}..."
rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
cp -R "$APP_PATH" "${INSTALL_DIR}/"

xattr -rd com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null || true

install_openforge_cli "${INSTALL_DIR}/${APP_NAME}.app" error

echo "Installed Electron ${APP_NAME} to ${INSTALL_DIR}/${APP_NAME}.app"
echo "Restart your shell or run: source ~/.zshrc"
