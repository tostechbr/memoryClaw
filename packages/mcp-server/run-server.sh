#!/bin/bash
# MCP Server wrapper for n8n
# Usage: ./run-server.sh

WORKSPACE="/Users/tiago.santos/Documents/GitHub/memory-claw/test-workspace-mcp"
DB_PATH="${WORKSPACE}/memory.db"

# Remove old database to force reindex
rm -f "$DB_PATH"

cd "$(dirname "$0")/../.."

exec node packages/mcp-server/dist/cli.js \
  --workspace="$WORKSPACE" \
  --db="$DB_PATH"
