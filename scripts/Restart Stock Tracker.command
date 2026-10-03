#!/bin/bash
# Double-click in Finder (or drag to the Dock) to restart the app on the
# currently checked-out branch. Same as running ./scripts/restart.sh.
cd "$(dirname "$0")/.." && ./scripts/restart.sh
