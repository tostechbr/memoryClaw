# MemoryClaw - MCP Server

MCP (Model Context Protocol) Server adapter for MemoryClaw. Exposes memory search and retrieval capabilities to AI agents via the standardized MCP protocol.

## Features

- **memory_search** - Semantic + keyword hybrid search across memory files
- **memory_get** - Retrieve specific content from memory files
- Supports stdio transport (for Claude Desktop, Cursor, etc.)
- Configurable embedding providers (OpenAI, local models)
- Hot-reload via file watching

## Installation

```bash
pnpm install @memory-claw/mcp-server
```

Or build from source:

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

## Quick Start

### Run as Standalone Server

```bash
# Using environment variables
export MEMORY_WORKSPACE_DIR=./workspace
export MEMORY_DB_PATH=./memory.db
export OPENAI_API_KEY=sk-...

memory-mcp-server
```

### Use with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "@memory-claw/mcp-server"
      ],
      "env": {
        "MEMORY_WORKSPACE_DIR": "/path/to/your/workspace",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Use with n8n

1. **Install n8n MCP node** (if available)
2. **Configure MCP Server connection**:
   - Protocol: stdio
   - Command: `npx @memory-claw/mcp-server`
   - Working directory: Your workspace path

3. **Use in workflow**:

```javascript
// n8n Code node
const results = $mcp.callTool('memory', 'memory_search', {
  query: 'project architecture',
  maxResults: 5
});

return results;
```

### Use with Cursor

Add to Cursor settings:

```json
{
  "mcp.servers": {
    "memory": {
      "command": "npx",
      "args": ["@memory-claw/mcp-server"],
      "env": {
        "MEMORY_WORKSPACE_DIR": "${workspaceFolder}",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMORY_WORKSPACE_DIR` | Directory containing MEMORY.md and memory/*.md | `process.cwd()` |
| `MEMORY_DB_PATH` | SQLite database path | `./memory.db` |
| `MEMORY_EMBEDDING_PROVIDER` | Embedding provider (openai, local) | `openai` |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI) | - |
| `MEMORY_EMBEDDING_MODEL` | Model name | `text-embedding-3-small` |

### Command Line Arguments

```bash
memory-mcp-server \
  --workspace=/path/to/workspace \
  --db=/path/to/memory.db \
  --provider=openai
```

## Tools

### memory_search

Search conversation memory using hybrid vector + keyword search.

**Parameters:**
- `query` (string, required) - Search query
- `maxResults` (number, optional) - Max results to return (default: 6)
- `minScore` (number, optional) - Minimum relevance score 0-1 (default: 0.35)

**Example:**

```json
{
  "query": "database architecture decisions",
  "maxResults": 5,
  "minScore": 0.4
}
```

**Response:**

```json
{
  "query": "database architecture decisions",
  "resultCount": 3,
  "results": [
    {
      "rank": 1,
      "path": "memory/2026-01-15.md",
      "lines": "45-52",
      "score": "0.847",
      "snippet": "Decided to use PostgreSQL for main database..."
    }
  ]
}
```

### memory_get

Retrieve specific lines from a memory file.

**Parameters:**
- `path` (string, required) - Relative path to file
- `from` (number, optional) - Starting line number (1-based)
- `lines` (number, optional) - Number of lines to read

**Example:**

```json
{
  "path": "memory/2026-01-15.md",
  "from": 45,
  "lines": 10
}
```

**Response:**

```
# Database Architecture

Decided to use PostgreSQL for main database because:
- Strong ACID guarantees
- JSON support for flexible schemas
- Mature ecosystem
...
```

## Development

```bash
# Watch mode
pnpm dev

# Build
pnpm build

# Type check
pnpm typecheck
```

## Architecture

```
┌─────────────────────────────────────┐
│  AI Agent (Claude, n8n, Cursor)    │
└───────────────┬─────────────────────┘
                │ MCP Protocol (stdio)
                ↓
┌─────────────────────────────────────┐
│  MCP Server                         │
│  ├─ Tool: memory_search             │
│  └─ Tool: memory_get                │
└───────────────┬─────────────────────┘
                │
                ↓
┌─────────────────────────────────────┐
│  MemoryClaw (Core)             │
│  ├─ MemoryManager                   │
│  ├─ HybridSearch                    │
│  └─ MemoryStorage (SQLite)          │
└─────────────────────────────────────┘
```

## Security

The MCP Server implements robust security measures:

- ✅ **Path Traversal Protection**: Prevents reading files outside workspace
- ✅ **File Size Limits**: 10MB max to prevent OOM attacks
- ✅ **API Key Security**: Uses environment variables, never hardcoded
- ✅ **Path Normalization**: Removes `..` components from file paths

See [SECURITY.md](./SECURITY.md) for detailed security documentation.

### Safe File Access

```json
// ✅ ALLOWED
{ "path": "memory/2026-01.md" }

// ❌ BLOCKED: Path traversal
{ "path": "../../../etc/passwd" }
// Response: "Error: Path outside workspace directory is not allowed"
```

## Troubleshooting

### "Could not locate the bindings file" error

The native `better-sqlite3` module needs to be compiled. Run:

```bash
cd node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3
npm run build-release
```

Or install with prebuilt binaries:

```bash
pnpm add @mapbox/better-sqlite3-prebuilt
```

### No search results returned

1. **Check if memory files are indexed**:
   - Ensure MEMORY.md or memory/*.md exist in workspace
   - Check file permissions

2. **Verify embedding provider**:
   - For OpenAI: Ensure OPENAI_API_KEY is set
   - For local: Check model is downloaded

3. **Lower minScore threshold**:
   ```json
   { "query": "...", "minScore": 0.2 }
   ```

### Server not starting

1. Check stdio connection (MCP uses stdio, not stdout)
2. Look for errors in stderr
3. Verify workspace directory exists

## License

MIT
