#!/bin/sh
# Double-click (or run) to start Huddle. Opens http://localhost:8765 in your browser.
cd "$(dirname "$0")"
exec python3 huddle.py "$@"
