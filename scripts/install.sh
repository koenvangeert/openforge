#!/bin/sh
set -eu

# BEGIN embedded OpenForge CLI install helpers (generated from scripts/openforge-cli-install.sh)
# Shared OpenForge macOS CLI install helpers.
# POSIX-compatible because scripts/install.sh sources this file with /bin/sh.

install_openforge_cli_payload() {
  openforge_cli_app_path=$1
  openforge_cli_missing_policy=${2:-warn}
  openforge_cli_source_dir="${openforge_cli_app_path}/Contents/Resources/openforge-cli"
  openforge_cli_target_dir="${HOME}/Library/Application Support/openforge/cli"

  if [ ! -f "${openforge_cli_source_dir}/cli.js" ]; then
    if [ "${openforge_cli_missing_policy}" = "error" ]; then
      echo "ERROR: OpenForge CLI payload not found at ${openforge_cli_source_dir}/cli.js" >&2
      return 1
    fi

    echo "WARNING: OpenForge CLI payload not found at ${openforge_cli_source_dir}/cli.js; continuing without updating CLI payload" >&2
    return 0
  fi

  rm -rf "${openforge_cli_target_dir}" || return 1
  mkdir -p "${openforge_cli_target_dir}" || return 1
  cp -R "${openforge_cli_source_dir}/." "${openforge_cli_target_dir}/" || return 1
  echo "Installed OpenForge CLI payload to ${openforge_cli_target_dir}"
}

install_openforge_cli_launcher() {
  openforge_cli_bin_dir="${HOME}/.openforge/bin"
  openforge_cli_target="${HOME}/Library/Application Support/openforge/cli/cli.js"
  openforge_cli_zshrc="${HOME}/.zshrc"

  mkdir -p "${openforge_cli_bin_dir}" || return 1
  if ! cat > "${openforge_cli_bin_dir}/openforge" <<EOF
#!/bin/sh
exec node "${openforge_cli_target}" "\$@"
EOF
  then
    return 1
  fi
  chmod 755 "${openforge_cli_bin_dir}/openforge" || return 1

  if ! grep -qs '\.openforge/bin' "${openforge_cli_zshrc}" 2>/dev/null; then
    {
      echo ""
      echo "# OpenForge CLI"
      echo 'export PATH="$HOME/.openforge/bin:$PATH"'
    } >> "${openforge_cli_zshrc}"
  fi

  echo "Installed OpenForge CLI launcher to ${openforge_cli_bin_dir}/openforge"
}

install_openforge_cli() {
  openforge_cli_app_path=$1
  openforge_cli_missing_policy=${2:-warn}

  install_openforge_cli_payload "${openforge_cli_app_path}" "${openforge_cli_missing_policy}" || return 1
  install_openforge_cli_launcher
}
# END embedded OpenForge CLI install helpers

cleanup() {
  if [ -n "${TMPDIR_PATH:-}" ]; then
    hdiutil detach "/Volumes/Open Forge" -quiet 2>/dev/null || true
    rm -rf "${TMPDIR_PATH}"
  fi
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

  install_openforge_cli "${INSTALL_DIR}/${APP_NAME}.app" warn

  echo "Successfully installed ${APP_NAME} v${VERSION} to ${INSTALL_DIR}/${APP_NAME}.app"
  echo "Launch with: open -a \"${APP_NAME}\""
  echo "Restart your shell or run: source ~/.zshrc"
}

main "$@"
