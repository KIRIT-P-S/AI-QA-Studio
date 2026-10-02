#!/bin/bash
# Installs application-local tools only; no sudo, Homebrew or system Python changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$(uname -s)" != 'Darwin' ]; then
  printf 'This setup is for macOS. Use the Windows package on Windows.\n' >&2
  exit 1
fi
MAC_VERSION="$(sw_vers -productVersion)"
MAC_MAJOR="${MAC_VERSION%%.*}"
if [ "$MAC_MAJOR" -lt 14 ]; then
  printf 'macOS 14 (Sonoma) or later is required by the testing browser. This Mac has %s.\n' "$MAC_VERSION" >&2
  exit 1
fi
if [ ! -w "$ROOT" ]; then
  printf 'Extract the app into a writable local folder such as Documents/AIQA.\n' >&2
  exit 1
fi
if /usr/bin/curl --silent --connect-timeout 1 --max-time 2 http://127.0.0.1:4319/health >/dev/null 2>&1; then
  printf 'Stop AI QA Studio and close its AI settings page before running setup again.\n' >&2
  exit 1
fi
MAC_ARCH="$(uname -m)"
if [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = '1' ]; then MAC_ARCH='arm64'; fi
case "$MAC_ARCH" in
  arm64)
    NODE_ARCH='arm64'
    UV_ARCH='aarch64'
    NODE_SHA='bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'
    UV_SHA='b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447'
    ;;
  x86_64)
    NODE_ARCH='x64'
    UV_ARCH='x86_64'
    NODE_SHA='1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097'
    UV_SHA='2b336763b396ec6afa20c5a8b083538ca7402445b868311979d740a4344c17d8'
    ;;
  *) printf 'Unsupported Mac processor: %s\n' "$MAC_ARCH" >&2; exit 1 ;;
esac

mkdir -p .setup/downloads runtime/node runtime/tools runtime/managed-python
chmod 700 .setup
/bin/rm -f "$ROOT/.setup/ready.json"
SETUP_SUCCESS=0
finish() {
  status=$?
  trap - EXIT
  if [ "$SETUP_SUCCESS" != '1' ]; then
    printf '\nSetup did not complete. Your project data and AI settings have not been reset.\n'
    printf 'Check the error above and internet access, then run Setup Mac.command again.\n'
  fi
  if [ -t 0 ]; then read -r -p 'Press Return to close this window.' reply || true; fi
  exit "$status"
}
trap finish EXIT

download_verified() {
  url="$1"; destination="$2"; expected="$3"
  if [ -f "$destination" ]; then
    existing="$(/usr/bin/shasum -a 256 "$destination" | /usr/bin/awk '{print $1}')"
  else existing=''; fi
  if [ "$existing" != "$expected" ]; then
    /usr/bin/curl --fail --location --retry 3 --connect-timeout 20 --max-time 900 "$url" --output "$destination.partial"
    actual="$(/usr/bin/shasum -a 256 "$destination.partial" | /usr/bin/awk '{print $1}')"
    if [ "$actual" != "$expected" ]; then printf 'Download verification failed. File was not executed.\n' >&2; return 1; fi
    /bin/mv "$destination.partial" "$destination"
  fi
}

printf '\nAI QA Studio - first-time Mac setup\n'
printf 'macOS %s, processor %s. All tools stay inside this app folder.\n' "$MAC_VERSION" "$MAC_ARCH"
printf 'Internet access is needed. Please keep this window open until Setup complete.\n\n'

printf '[1/6] Downloading verified Node.js for this Mac...\n'
NODE_ARCHIVE="node-v24.21.0-darwin-$NODE_ARCH.tar.gz"
download_verified "https://nodejs.org/dist/v24.21.0/$NODE_ARCHIVE" "$ROOT/.setup/downloads/$NODE_ARCHIVE" "$NODE_SHA"
/usr/bin/tar -xzf "$ROOT/.setup/downloads/$NODE_ARCHIVE" -C "$ROOT/runtime/node" --strip-components 1
export PATH="$ROOT/runtime/node/bin:$PATH"

printf '[2/6] Preparing managed Python 3.12...\n'
UV_ARCHIVE="uv-$UV_ARCH-apple-darwin.tar.gz"
download_verified "https://github.com/astral-sh/uv/releases/download/0.12.21/$UV_ARCHIVE" "$ROOT/.setup/downloads/$UV_ARCHIVE" "$UV_SHA"
/usr/bin/tar -xzf "$ROOT/.setup/downloads/$UV_ARCHIVE" -C "$ROOT/runtime/tools" --strip-components 1
UV="$ROOT/runtime/tools/uv"
export UV_PYTHON_INSTALL_DIR="$ROOT/runtime/managed-python"
export UV_PYTHON_INSTALL_BIN=0
export UV_CACHE_DIR="$ROOT/.setup/uv-cache"
"$UV" python install 3.12 --no-bin
"$UV" venv --allow-existing --managed-python --python 3.12 "$ROOT/backend/venv"

printf '[3/6] Installing application dependencies for this Mac...\n'
"$UV" pip install --python "$ROOT/backend/venv/bin/python" -r "$ROOT/backend/requirements.txt"
export npm_config_cache="$ROOT/.setup/npm-cache"
export NEXT_TELEMETRY_DISABLED=1
"$ROOT/runtime/node/bin/node" "$ROOT/runtime/node/lib/node_modules/npm/bin/npm-cli.js" --prefix web ci
"$ROOT/runtime/node/bin/node" "$ROOT/runtime/node/lib/node_modules/npm/bin/npm-cli.js" --prefix agent ci

printf '[4/6] Installing the matching testing browser...\n'
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/runtime/browsers"
"$ROOT/runtime/node/bin/node" "$ROOT/agent/node_modules/playwright/cli.js" install chromium

printf '[5/6] Building the production application on this Mac...\n'
"$ROOT/runtime/node/bin/node" "$ROOT/runtime/node/lib/node_modules/npm/bin/npm-cli.js" --prefix web run build

printf '[6/6] Checking Python, native architecture and the actual browser...\n'
"$ROOT/runtime/node/bin/node" "$ROOT/scripts/verify-mac-install.cjs"
SETUP_SUCCESS=1
printf '\nSetup complete.\n'
printf 'Next: double-click Configure AI.command to enter your own Gemini key.\n'
printf 'Then double-click Start AI QA Studio.command or Start Client Demo.command.\n'
printf 'For supplied demo tests, you may skip AI configuration.\n'
