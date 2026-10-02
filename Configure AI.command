#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x runtime/node/bin/node ] || [ ! -f .setup/ready.json ]; then
  printf '\nPlease run Setup Mac.command first.\n'
  read -r -p 'Press Return to close.' reply
  exit 1
fi
exec runtime/node/bin/node scripts/desktop.cjs configure
