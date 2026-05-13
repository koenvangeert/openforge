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

  rm -rf "${openforge_cli_target_dir}"
  mkdir -p "${openforge_cli_target_dir}"
  cp -R "${openforge_cli_source_dir}/." "${openforge_cli_target_dir}/"
  echo "Installed OpenForge CLI payload to ${openforge_cli_target_dir}"
}

install_openforge_cli_launcher() {
  openforge_cli_bin_dir="${HOME}/.openforge/bin"
  openforge_cli_target="${HOME}/Library/Application Support/openforge/cli/cli.js"
  openforge_cli_zshrc="${HOME}/.zshrc"

  mkdir -p "${openforge_cli_bin_dir}"
  cat > "${openforge_cli_bin_dir}/openforge" <<EOF
#!/bin/sh
exec node "${openforge_cli_target}" "\$@"
EOF
  chmod 755 "${openforge_cli_bin_dir}/openforge"

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

  if ! install_openforge_cli_payload "${openforge_cli_app_path}" "${openforge_cli_missing_policy}"; then
    return 1
  fi

  install_openforge_cli_launcher
}
