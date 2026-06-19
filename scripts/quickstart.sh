#!/usr/bin/env bash
# Prism quickstart: install, build, and run the Prism Index + explorer locally.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
npm install

echo "==> Building the workspace"
npm run build

echo "==> Starting the Prism Index on http://localhost:8787"
echo "    (the explorer's API; open public/index.html or deploy to serve the UI)"
node apps/index/dist/server.js
