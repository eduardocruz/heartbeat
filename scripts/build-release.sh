#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p dist

bun build --compile --target=bun-darwin-arm64 src/cli/index.ts --outfile dist/heartbeat-darwin-arm64
bun build --compile --target=bun-darwin-x64 src/cli/index.ts --outfile dist/heartbeat-darwin-x64
bun build --compile --target=bun-linux-x64 src/cli/index.ts --outfile dist/heartbeat-linux-x64
