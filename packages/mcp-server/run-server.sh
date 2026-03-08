#!/bin/bash
# MCP Server wrapper for n8n
# Usage: ./run-server.sh
#
# The workspace defaults to packages/mcp-server/data/
# Override with: MEMORY_WORKSPACE_DIR=/path/to/dir ./run-server.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${MEMORY_WORKSPACE_DIR:-$SCRIPT_DIR/data}"

mkdir -p "$WORKSPACE"

cd "$SCRIPT_DIR/../.."

exec node packages/mcp-server/dist/cli.js \
  --workspace="$WORKSPACE"
