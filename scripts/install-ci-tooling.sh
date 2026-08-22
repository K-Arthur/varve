#!/usr/bin/env bash
# CI/CD Tooling Installation Script for CachyOS/Arch Linux
# 
# Installs required tools for local GitHub Actions development and testing:
# - GitHub CLI (gh) for log retrieval and API access
# - act for local GitHub Actions testing
# - docker for container execution (required by act)
#
# Usage:
#   sudo bash scripts/install-ci-tooling.sh
#   or
#   bash scripts/install-ci-tooling.sh --user  # for user-space installation

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_INSTALL=false
ACT_MIN_VERSION="0.2.89"

# Parse arguments
for arg in "$@"; do
  if [ "$arg" = "--user" ]; then
    USER_INSTALL=true
  fi
done

echo "=== Varve CI/CD Tooling Installation ==="
echo "Repository root: $REPO_ROOT"
echo ""

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to install with pacman
install_pacman() {
  if [ "$USER_INSTALL" = true ]; then
    echo "⚠️  User installation requested, but $1 requires system installation"
    echo "    Please run: sudo pacman -S $1"
    return 1
  fi
  
  if command_exists "$1"; then
    echo "✅ $1 already installed"
    return 0
  fi
  
  echo "📦 Installing $1..."
  sudo pacman -S --noconfirm "$1"
}

# Function to install from AUR
install_aur() {
  local pkg="$1"
  
  if command_exists "$pkg"; then
    echo "✅ $pkg already installed"
    return 0
  fi
  
  echo "📦 Installing $pkg from AUR..."
  
  # Check for AUR helpers
  if command_exists yay; then
    yay -S --noconfirm "$pkg"
  elif command_exists paru; then
    paru -S --noconfirm "$pkg"
  else
    echo "⚠️  No AUR helper found. Please install yay or paru:"
    echo "    sudo pacman -S --needed base-devel git"
    echo "    git clone https://aur.archlinux.org/yay.git /tmp/yay"
    echo "    cd /tmp/yay && makepkg -si"
    echo "    Then re-run this script"
    return 1
  fi
}

# Function to install Docker
install_docker() {
  if command_exists docker; then
    echo "✅ Docker already installed"
    
    # Check if Docker is running
    if docker info >/dev/null 2>&1; then
      echo "✅ Docker daemon is running"
    else
      echo "⚠️  Docker is installed but not running"
      echo "    Start it with: sudo systemctl start docker"
      echo "    Enable it with: sudo systemctl enable docker"
    fi
    return 0
  fi
  
  if [ "$USER_INSTALL" = true ]; then
    echo "⚠️  Docker requires system installation"
    echo "    Please run: sudo pacman -S docker"
    return 1
  fi
  
  echo "📦 Installing Docker..."
  sudo pacman -S --noconfirm docker
  
  echo "🚀 Starting Docker daemon..."
  sudo systemctl start docker
  sudo systemctl enable docker
  
  # Add current user to docker group
  echo "👤 Adding $USER to docker group..."
  sudo usermod -aG docker "$USER"
  
  echo "⚠️  Log out and back in for group changes to take effect"
}

# Function to install GitHub CLI
install_gh() {
  if command_exists gh; then
    echo "✅ GitHub CLI (gh) already installed"
    return 0
  fi
  
  if [ "$USER_INSTALL" = true ]; then
    echo "📦 Installing GitHub CLI (gh) from binary..."
    
    local ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64) ARCH="x86_64" ;;
      aarch64) ARCH="arm64" ;;
      *) echo "❌ Unsupported architecture: $ARCH"; return 1 ;;
    esac
    
    local VERSION="2.56.0"
    local URL="https://github.com/cli/cli/releases/download/v${VERSION}/gh_${VERSION}_linux_${ARCH}.tar.gz"
    local TMP_DIR="/tmp/gh-install"
    
    mkdir -p "$TMP_DIR"
    curl -L "$URL" -o "$TMP_DIR/gh.tar.gz"
    tar -xzf "$TMP_DIR/gh.tar.gz" -C "$TMP_DIR"
    
    mkdir -p "$HOME/.local/bin"
    cp "$TMP_DIR/gh_${VERSION}_linux_${ARCH}/bin/gh" "$HOME/.local/bin/gh"
    chmod +x "$HOME/.local/bin/gh"
    
    rm -rf "$TMP_DIR"
    
    echo "✅ GitHub CLI installed to $HOME/.local/bin/gh"
    echo "   Ensure $HOME/.local/bin is in your PATH"
  else
    install_pacman github-cli
  fi
}

# Function to install act
install_act() {
  if command_exists act; then
    local installed
    installed="$(act --version 2>/dev/null | sed -nE 's/.*act version ([0-9]+(\.[0-9]+){2}).*/\1/p' | head -n 1)"
    if [ -n "$installed" ] && [ "$(printf '%s\n' "$ACT_MIN_VERSION" "$installed" | sort -V | tail -n 1)" = "$installed" ]; then
      echo "✅ act $installed already installed"
      return 0
    fi
    echo "⚠️  act ${installed:-unknown} is too old; ${ACT_MIN_VERSION}+ is required for Node 24 actions"
    if command_exists yay; then
      yay -S --noconfirm act
    elif command_exists paru; then
      paru -S --noconfirm act
    else
      echo "❌ No AUR helper found. Upgrade act from https://github.com/nektos/act/releases"
      return 1
    fi
    return 0
  fi
  
  install_aur act
}

# Container engine check. act needs a running engine (docker or podman) for
# full job execution; --list and dry-run work without one.
check_act_parity() {
  local ok=0
  echo "=== Local act parity ==="
  if ! command_exists act; then
    echo "❌ act is not installed. Run: sudo bash scripts/install-ci-tooling.sh"
    return 1
  fi
  local installed
  installed="$(act --version 2>/dev/null | sed -nE 's/.*act version ([0-9]+(\.[0-9]+){2}).*/\1/p' | head -n 1)"
  if [ -z "$installed" ] || [ "$(printf '%s\n' "$ACT_MIN_VERSION" "$installed" | sort -V | tail -n 1)" != "$installed" ]; then
    echo "❌ act ${installed:-unknown} is too old. act ${ACT_MIN_VERSION} or newer is required for Node 24 actions."
    echo "   Upgrade from https://github.com/nektos/act/releases or with: yay -S act"
    return 1
  fi
  echo "✅ act $installed"

  if command_exists docker && docker info >/dev/null 2>&1; then
    echo "✅ docker daemon running — full local job execution available"
    ok=1
  elif command_exists podman && podman info >/dev/null 2>&1; then
    echo "✅ podman running — full local job execution available"
    ok=1
  elif command_exists docker; then
    echo "⚠️  docker installed but not running"
    echo "    Start it with: sudo systemctl start docker"
  elif command_exists podman; then
    echo "⚠️  podman installed but not running"
    echo "    Start it with: systemctl --user start podman"
  else
    echo "⚠️  no container engine found (docker or podman)"
    echo "    Install one: sudo pacman -S docker && sudo systemctl start docker"
  fi

  if [ "$ok" = 1 ]; then
    echo "✅ act list / dry-run / run all available"
  else
    echo "ℹ️  act list + dry-run work without an engine:"
    echo "      just act-list"
    echo "      just act-dry .github/workflows/ci.yml"
    echo "   act run needs the engine: just act-run js"
  fi
}

# Main installation
echo "🔍 Checking for installed tools..."
echo ""

if [ "${1:-}" = "--check" ]; then
  check_act_parity
  exit 0
fi

# Install Docker first (required by act)
echo "=== Docker ==="
install_docker
echo ""

# Install GitHub CLI
echo "=== GitHub CLI ==="
install_gh
echo ""

# Install act
echo "=== act (local GitHub Actions) ==="
install_act
echo ""

# Create act secrets stub
echo "=== Configuration ==="
ACT_SECRETS="$REPO_ROOT/.act-secrets"
if [ ! -f "$ACT_SECRETS" ]; then
  echo "📝 Creating act secrets stub..."
  cat > "$ACT_SECRETS" <<'EOF'
# GitHub Actions secrets for local act runs.
# GITHUB_TOKEN=<your-token>
EOF
  echo "✅ Created $ACT_SECRETS"
  echo "   Add GITHUB_TOKEN to run workflows that need API access"
else
  echo "✅ act secrets file already exists"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Installed tools:"
command_exists docker && echo "  ✅ docker"
command_exists gh && echo "  ✅ gh (GitHub CLI)"
command_exists act && echo "  ✅ act (local GitHub Actions)"
echo ""
echo "Next steps:"
echo "  1. If you just installed Docker, log out and back in for group changes"
echo "  2. Authenticate with GitHub: gh auth login"
echo "  3. Test local workflows: just act-list"
echo "  4. Run a specific job: just act-run js"
echo ""
echo "For user-space installations, ensure your PATH includes:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
