#!/bin/sh
set -eu
cd "$(dirname "$0")"
test -f hello.txt
test -f README.md
echo "toy-repo tests passed"
