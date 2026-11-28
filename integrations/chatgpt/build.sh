#!/usr/bin/env bash
# Builds the ChatGPT plugin ZIP for the OpenAI plugin submission portal.
# Output: integrations/chatgpt/dist/rootfetch-chatgpt-<version>.zip (not committed).
set -euo pipefail
cd "$(dirname "$0")"
version=$(python3 -c "import json;print(json.load(open('plugin.json'))['version'])")
rm -rf dist build && mkdir -p dist build/assets
cp plugin.json mcp.json build/
cp -r skills build/
python3 -c "import sys;sys.path.insert(0,'../../scripts');from pathlib import Path;import og_images as o;o.logo_image(Path('build/assets/icon.png'))"
cp build/assets/icon.png build/assets/logo.png
python3 -c "import json;[json.load(open(f)) for f in ['build/plugin.json','build/mcp.json']];print('json ok')"
(cd build && zip -qr "../dist/rootfetch-chatgpt-${version}.zip" .)
rm -rf build
unzip -l "dist/rootfetch-chatgpt-${version}.zip"
