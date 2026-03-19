#!/usr/bin/env bash
set -euo pipefail

REPO="${HEARTBEAT_INSTALL_REPO:-eduardocruz/heartbeat}"
VERSION="${HEARTBEAT_VERSION:-latest}"
BINARY_NAME="heartbeat"
BASE_URL="${HEARTBEAT_INSTALL_BASE_URL:-}"

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "Unsupported operating system: $os" >&2
      exit 1
      ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *)
      echo "Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac

  printf '%s-%s\n' "$os" "$arch"
}

resolve_download_url() {
  local platform="$1"
  local asset="${BINARY_NAME}-${platform}"

  if [[ -n "$BASE_URL" ]]; then
    printf '%s/%s\n' "$BASE_URL" "$asset"
    return
  fi

  if [[ "$VERSION" == "latest" ]]; then
    printf 'https://github.com/%s/releases/latest/download/%s\n' "$REPO" "$asset"
  else
    printf 'https://github.com/%s/releases/download/%s/%s\n' "$REPO" "$VERSION" "$asset"
  fi
}

pick_install_dir() {
  if [[ -w /usr/local/bin ]]; then
    printf '/usr/local/bin\n'
  else
    printf '%s/.heartbeat/bin\n' "$HOME"
  fi
}

detect_shell_profile() {
  local shell_name
  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    zsh)  printf '%s/.zshrc\n' "$HOME" ;;
    bash) printf '%s/.bashrc\n' "$HOME" ;;
    fish) printf '%s/.config/fish/config.fish\n' "$HOME" ;;
    *)    printf '%s/.profile\n' "$HOME" ;;
  esac
}

add_to_path_if_needed() {
  local install_dir="$1"
  local export_line="export PATH=\"$install_dir:\$PATH\""

  if [[ ":$PATH:" == *":$install_dir:"* ]]; then
    return
  fi

  local profile
  profile="$(detect_shell_profile)"

  if grep -qF "$install_dir" "$profile" 2>/dev/null; then
    return
  fi

  printf '\n# Added by HeartBeat installer\n%s\n' "$export_line" >> "$profile"
  echo "Added to $profile: $export_line"
  echo "Run: source $profile"
}

main() {
  local platform install_dir download_url tmpdir tmpfile

  platform="$(detect_platform)"
  install_dir="$(pick_install_dir)"
  download_url="$(resolve_download_url "$platform")"
  tmpdir="$(mktemp -d)"
  tmpfile="$tmpdir/$BINARY_NAME"

  mkdir -p "$install_dir"

  echo "Downloading $download_url"
  curl -fsSL "$download_url" -o "$tmpfile"
  chmod +x "$tmpfile"
  mv "$tmpfile" "$install_dir/$BINARY_NAME"

  echo "Installed to $install_dir/$BINARY_NAME"
  add_to_path_if_needed "$install_dir"

  "$install_dir/$BINARY_NAME" --version
  rm -rf "$tmpdir"

  echo ""
  echo "✅ HeartBeat installed! To start using it:"
  echo ""
  echo "   source ~/.zshrc   (or open a new terminal)"
  echo "   heartbeat start"
  echo ""
}

main "$@"
