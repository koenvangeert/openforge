#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Open Forge"
INSTALL_DIR="/Applications"

stop_running_app() {
  if pgrep -xq "${APP_NAME}"; then
    echo "Closing running instance..."
    osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
    sleep 1
    pkill -x "${APP_NAME}" 2>/dev/null || true
  fi

  if pgrep -fq 'Open Forge.app/Contents/MacOS/openforge-sidecar'; then
    echo "Stopping stale Electron sidecar..."
    pkill -f 'Open Forge.app/Contents/MacOS/openforge-sidecar' 2>/dev/null || true
  fi
}

install_cli_payload() {
  local app_path="${INSTALL_DIR}/${APP_NAME}.app"
  local cli_source_dir="${app_path}/Contents/Resources/openforge-cli"
  local cli_target_dir="${HOME}/Library/Application Support/openforge/cli"

  if [ ! -f "${cli_source_dir}/cli.js" ]; then
    echo "ERROR: OpenForge CLI payload not found at ${cli_source_dir}/cli.js" >&2
    exit 1
  fi

  rm -rf "${cli_target_dir}"
  mkdir -p "${cli_target_dir}"
  cp -R "${cli_source_dir}/." "${cli_target_dir}/"
  echo "Installed OpenForge CLI payload to ${cli_target_dir}"
}

install_cli_launcher() {
  local cli_bin_dir="${HOME}/.openforge/bin"
  local cli_target="${HOME}/Library/Application Support/openforge/cli/cli.js"
  local zshrc="${HOME}/.zshrc"

  mkdir -p "${cli_bin_dir}"
  cat > "${cli_bin_dir}/openforge" <<EOF
#!/bin/sh
exec node "${cli_target}" "\$@"
EOF
  chmod 755 "${cli_bin_dir}/openforge"

  if ! grep -qs '\.openforge/bin' "${zshrc}" 2>/dev/null; then
    {
      echo ""
      echo "# OpenForge CLI"
      echo 'export PATH="$HOME/.openforge/bin:$PATH"'
    } >> "${zshrc}"
  fi

  echo "Installed OpenForge CLI launcher to ${cli_bin_dir}/openforge"
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

install_cli_payload
install_cli_launcher

echo "Installed Electron ${APP_NAME} to ${INSTALL_DIR}/${APP_NAME}.app"
echo "Restart your shell or run: source ~/.zshrc"
