#!/usr/bin/env bash
# Start the app with hot reload (npm run dev) from the project folder.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "node_modules not found, running npm install first..."
  npm install
fi

exec npm run dev
