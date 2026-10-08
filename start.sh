#!/usr/bin/env bash
# ClawBack launcher for macOS / Linux
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "ClawBack needs Node.js 22 LTS or newer: https://nodejs.org"
  exit 1
fi
exec node scripts/launch.mjs "$@"
