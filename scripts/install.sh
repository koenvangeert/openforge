#!/bin/sh
set -eu

cleanup() {
  if [ -n "${TMPDIR_PATH:-}" ]; then
    hdiutil detach "/Volumes/Open Forge" -quiet 2>/dev/null || true
    rm -rf "${TMPDIR_PATH}"
  fi
}

install_cli_payload() {
  APP_PATH="${INSTALL_DIR}/${APP_NAME}.app"
  CLI_SOURCE_DIR="${APP_PATH}/Contents/Resources/openforge-cli"
  CLI_TARGET_DIR="${HOME}/Library/Application Support/openforge/cli"

  if [ ! -f "${CLI_SOURCE_DIR}/cli.js" ]; then
    echo "WARNING: OpenForge CLI payload not found at ${CLI_SOURCE_DIR}/cli.js; continuing without updating CLI payload" >&2
    return 0
  fi

  rm -rf "${CLI_TARGET_DIR}"
  mkdir -p "${CLI_TARGET_DIR}"
  cp -R "${CLI_SOURCE_DIR}/." "${CLI_TARGET_DIR}/"
  echo "Installed OpenForge CLI payload to ${CLI_TARGET_DIR}"
}

install_cli_launcher() {
  CLI_BIN_DIR="${HOME}/.openforge/bin"
  CLI_TARGET="${HOME}/Library/Application Support/openforge/cli/cli.js"
  ZSHRC="${HOME}/.zshrc"

  mkdir -p "${CLI_BIN_DIR}"
  cat > "${CLI_BIN_DIR}/openforge" <<EOF
#!/bin/sh
exec node "${CLI_TARGET}" "\$@"
EOF
  chmod 755 "${CLI_BIN_DIR}/openforge"

  if ! grep -qs '\.openforge/bin' "${ZSHRC}" 2>/dev/null; then
    {
      echo ""
      echo "# OpenForge CLI"
      echo 'export PATH="$HOME/.openforge/bin:$PATH"'
    } >> "${ZSHRC}"
  fi

  echo "Installed OpenForge CLI launcher to ${CLI_BIN_DIR}/openforge"
}

main() {
  REPO="koenvangeert/openforge"
  APP_NAME="Open Forge"
  INSTALL_DIR="/Applications"

  # Check macOS version
  MACOS_VERSION=$(sw_vers -productVersion)
  MAJOR_VERSION=$(echo "$MACOS_VERSION" | cut -d. -f1)

  if [ "$MAJOR_VERSION" -lt 11 ]; then
    echo "ERROR: macOS 11.0 (Big Sur) or later required. You have $MACOS_VERSION" >&2
    exit 1
  fi

  # Detect architecture
  if sysctl -n hw.optional.arm64 2>/dev/null | grep -q 1; then
    ARCH="aarch64"
  else
    ARCH="x64"
  fi

  # Resolve version
  if [ -n "${OPENFORGE_VERSION:-}" ]; then
    VERSION="${OPENFORGE_VERSION}"
    # Strip leading 'v' if present
    VERSION="${VERSION#v}"
  else
    echo "Fetching latest release..."
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
    if [ -z "$RELEASE_JSON" ]; then
      echo "ERROR: Failed to fetch latest release from GitHub" >&2
      exit 1
    fi
    VERSION=$(echo "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
    # Strip leading 'v' if present
    VERSION="${VERSION#v}"
    if [ -z "$VERSION" ]; then
      echo "ERROR: Could not parse version from GitHub API response" >&2
      exit 1
    fi
  fi

  echo "Installing Open Forge v${VERSION} (${ARCH})..."

  # Create temp directory
  TMPDIR_PATH=$(mktemp -d)
  trap cleanup EXIT

  # Construct download URL
  URL="https://github.com/${REPO}/releases/download/v${VERSION}/Open.Forge_${VERSION}_${ARCH}.dmg"

  # Download DMG
  echo "Downloading from ${URL}..."
  if ! curl -fSL -o "${TMPDIR_PATH}/Open.Forge.dmg" "${URL}"; then
    echo "ERROR: Failed to download DMG" >&2
    exit 1
  fi

  # Close running instance if any
  if pgrep -xq "${APP_NAME}"; then
    echo "Closing running instance..."
    osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
    sleep 1
    pkill -x "${APP_NAME}" 2>/dev/null || true
  fi

  # Mount DMG
  echo "Mounting DMG..."
  if ! hdiutil attach -nobrowse -quiet "${TMPDIR_PATH}/Open.Forge.dmg"; then
    echo "ERROR: Failed to mount DMG" >&2
    exit 1
  fi

  # Install app
  echo "Installing to ${INSTALL_DIR}..."
  rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
  if ! cp -R "/Volumes/Open Forge/Open Forge.app" "${INSTALL_DIR}/"; then
    echo "ERROR: Failed to copy app to ${INSTALL_DIR}" >&2
    exit 1
  fi

  # Clear quarantine attribute
  xattr -rd com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app"

  install_cli_payload
  install_cli_launcher

  echo "Successfully installed ${APP_NAME} v${VERSION} to ${INSTALL_DIR}/${APP_NAME}.app"
  echo "Launch with: open -a \"${APP_NAME}\""
  echo "Restart your shell or run: source ~/.zshrc"
}

main "$@"
