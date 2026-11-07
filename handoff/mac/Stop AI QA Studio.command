#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x runtime/node/bin/node ]; then printf 'AI QA Studio has not been set up yet.\n'; exit 0; fi
exec runtime/node/bin/node scripts/desktop.cjs stop
