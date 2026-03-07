<div align="center">

# Akashic Context

**Universal Memory & Context Engine for LLMs**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-MCP-orange)](https://modelcontextprotocol.io)

</div>

> "Akashic Context" implies a universal, infinite context for your AI.

Akashic Context is an open-source library that adds **persistent memory** and **intelligent context management** to AI agents. Your agents can remember past conversations, decisions, and context across sessions - while automatically managing token limits.

## The Vision

```
┌─────────────────────────────────────────────────────────────┐
│                    AKASHIC CONTEXT                          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Memory    │  │   Context   │  │   Session   │         │
│  │   Search    │  │  Management │  │  Lifecycle  │         │
│  │  (Phase 1)  │  │  (Phase 2)  │  │  (Phase 3)  │         │
│  │     ✅      │  │     🚧      │  │     📋      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  Store memories → Search intelligently → Manage limits     │
└─────────────────────────────────────────────────────────────┘
```

## Current Status: Phase 1 - Memory Search ✅ + Sprint 0 Next

**What works today:**
- Store memories in Markdown files (human-readable, git-friendly)
- Search using BM25 keyword matching
- Full CRUD via MCP Protocol (search, get, store, delete)
- Chunk large files for better search results
- 140 tests passing (unit + integration + QA)

**⚠️ Current limitation:** No multi-user isolation. All users share the same workspace. **Sprint 0 (next)** will add `userId` parameter to all tools for per-user memory isolation.

**Coming in Sprint 0:** Multi-user isolation (userId per tool, per-user database)

**Coming in Phase 2:** Vector search (sqlite-vec, hybrid merge)

**Coming in Phase 3:** Context management (compaction, memory flush, pruning)

## Quick Start with n8n

### 1. Clone and Build

```bash
git clone https://github.com/tostechbr/akashic-context.git
cd akashic-context
pnpm install
pnpm build
```

### 2. Create Your Memory Files

```
my-workspace/
├── MEMORY.md           # Long-term curated knowledge
└── memory/
    ├── 2026-01-31.md   # Daily notes
    ├── projects.md     # Project notes
    └── contacts.md     # Important contacts
```

Example `MEMORY.md`:

```markdown
# My Memory

## About Me
I'm a developer working on AI projects.

## Current Projects
- Akashic Context - Adding memory to AI agents
- My App - A productivity tool

## Important Contacts
- John: john@email.com - Technical mentor
- Sarah: sarah@email.com - Design partner
```

### 3. Install n8n Community Node

**IMPORTANT:** This integration uses the **n8n-nodes-mcp** community node, which must be installed separately.

**In your n8n instance:**

1. Go to **Settings** → **Community Nodes**
2. Click **Install a community node**
3. Enter: `n8n-nodes-mcp`
4. Click **Install**
5. Restart n8n after installation

**Documentation:** https://www.npmjs.com/package/n8n-nodes-mcp

### 4. Configure MCP Server

**Edit `packages/mcp-server/run-server.sh`** to point to your workspace:

```bash
WORKSPACE="/path/to/your/my-workspace"
```

**Create MCP Credential in n8n:**

1. Go to **Credentials** → **Create New**
2. Search for "MCP" and select **MCP API**
3. Fill in the fields:

| Field | Value |
|-------|-------|
| Name | `Akashic Context` |
| Command | `bash` |
| Arguments | `/absolute/path/to/akashic-context/packages/mcp-server/run-server.sh` |
| Environments | `OPENAI_API_KEY=sk-your-actual-key` |

4. Click **Save**

**Important:** Use the **absolute path** to `run-server.sh`. Relative paths will not work.

### 5. Import Working Workflow

Create a new workflow in n8n and import this JSON:

```json
{
  "name": "Akashic Memory Test",
  "nodes": [
    {
      "parameters": {
        "options": {}
      },
      "type": "@n8n/n8n-nodes-langchain.chatTrigger",
      "typeVersion": 1.1,
      "position": [460, 240],
      "id": "chat-trigger",
      "name": "When chat message received"
    },
    {
      "parameters": {
        "promptType": "define",
        "text": "={{ $json.chatInput }}",
        "options": {
          "systemMessage": "You are a personal assistant with access to the user's memory. Use the memory_search tool to find relevant information before answering questions."
        }
      },
      "type": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 1.7,
      "position": [680, 240],
      "id": "ai-agent",
      "name": "AI Agent"
    },
    {
      "parameters": {
        "model": "gpt-4o-mini"
      },
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1,
      "position": [680, 440],
      "id": "openai-model",
      "name": "OpenAI Chat Model",
      "credentials": {
        "openAiApi": {
          "id": "your-openai-credential",
          "name": "OpenAI account"
        }
      }
    },
    {
      "parameters": {
        "operation": "executeTool",
        "toolName": "memory_search",
        "toolParameters": "{\"query\": \"{{ $json.chatInput.replace(/\\n/g, ' ').trim() }}\", \"minScore\": 0}"
      },
      "type": "n8n-nodes-mcp.mcpClientTool",
      "typeVersion": 1,
      "position": [680, 80],
      "id": "mcp-client",
      "name": "MCP Client",
      "credentials": {
        "mcpApi": {
          "id": "your-mcp-credential",
          "name": "Akashic Context"
        }
      }
    }
  ],
  "connections": {
    "When chat message received": {
      "main": [[{ "node": "AI Agent", "type": "main", "index": 0 }]]
    },
    "OpenAI Chat Model": {
      "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]]
    },
    "MCP Client": {
      "ai_tool": [[{ "node": "AI Agent", "type": "ai_tool", "index": 0 }]]
    }
  }
}
```

**After importing:**

1. Open the **OpenAI Chat Model** node and select your OpenAI credential
2. Open the **MCP Client** node and select your Akashic Context credential
3. Save the workflow
4. Activate the workflow (toggle in top-right)

### 6. Test It!

Open the workflow chat interface and ask:
- "What projects am I working on?"
- "Who is my technical mentor?"
- "What did we discuss yesterday?"

**Expected behavior:**
- The AI Agent will use the `memory_search` tool to query your memory files
- Results will be returned from MEMORY.md and memory/*.md files
- The agent will answer based on the search results

### Troubleshooting

**Problem:** MCP Client node shows "Tool not found: memory_search"

**Solution:**
- Check that `run-server.sh` has the correct absolute path to your workspace
- Verify `OPENAI_API_KEY` is set in the MCP credential
- Check n8n logs for MCP server startup errors
- Test the MCP server directly: `cd packages/mcp-server && node test-simple.js`

**Problem:** Search returns no results

**Solution:**
- Ensure MEMORY.md or memory/*.md files exist in your workspace
- Check that the files contain text content
- Try setting `"minScore": 0` in the toolParameters to see all results
- Rebuild the project: `pnpm build`

**Problem:** "n8n-nodes-mcp not found"

**Solution:**
- The community node must be installed via n8n's UI (Settings → Community Nodes)
- Restart n8n after installation
- Check n8n version compatibility (requires n8n 1.0+)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agent (Claude, GPT, etc.) + userId                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (stdio)                                         │
│  Tools: memory_search, memory_get, memory_store, memory_del │
│  + userId param → per-user isolation (Sprint 0 - planned)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Core Library                                               │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Chunking   │  │   Storage    │  │   Search     │      │
│  │  400 tokens  │  │   SQLite     │  │  BM25 + Vec  │      │
│  │  80 overlap  │  │   + FTS5     │  │   (hybrid)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Memory Files (per user - planned)                          │
│  users/{userId}/MEMORY.md + memory/*.md                     │
│  users/{userId}/memory.db                                   │
└─────────────────────────────────────────────────────────────┘
```

## Roadmap

### Phase 1: Memory Search ✅ Current

| Feature | Status | Description |
|---------|--------|-------------|
| Memory Storage | ✅ Done | MEMORY.md + memory/*.md |
| Markdown Chunking | ✅ Done | ~400 tokens, 80 overlap |
| SQLite + FTS5 | ✅ Done | Keyword indexing |
| BM25 Search | ✅ Done | Keyword matching |
| Embedding Cache | ✅ Done | Hash-based deduplication |
| MCP Server | ✅ Done | stdio transport, 4 tools (search, get, store, delete) |
| n8n Integration | ✅ Done | Works with AI Agent node |
| Integration Tests | ✅ Done | 15 end-to-end tests |
| QA Scenarios | ✅ Done | 17 assertions, 4 real-user scenarios |

### Sprint 0: Multi-User Isolation 🎯 Next

| Feature | Status | Description |
|---------|--------|-------------|
| userId Parameter | 🎯 Planned | Add userId to all 4 MCP tools |
| Per-User Workspace | 🎯 Planned | `users/{userId}/MEMORY.md + memory/*.md` |
| Per-User Database | 🎯 Planned | `users/{userId}/memory.db` — total isolation |
| Manager Pool | 🎯 Planned | LRU pool of MemoryManagers per userId |
| Backward Compat | 🎯 Planned | No userId → defaults to `"default"` user |
| WhatsApp Workflow | 🎯 Planned | n8n example with phone as userId |

### Phase 1.5: Memory Foundation 📋 After Sprint 0

| Feature | Status | Description |
|---------|--------|-------------|
| sqlite-vec Extension | 📋 Planned | Load vector extension |
| Vector Search | 📋 Planned | Cosine similarity search |
| Hybrid Merge | 📋 Planned | 70% vector + 30% keyword |
| Embedding Batch API | 📋 Planned | OpenAI Batch (50% cheaper) |

### Phase 2: Context Management 🚧 Planned

| Feature | Status | Description |
|---------|--------|-------------|
| Token Counting | 📋 Planned | Measure context usage |
| Context Window Guard | 📋 Planned | Warn/block thresholds |
| Memory Flush | 📋 Planned | Save before compaction |
| Compaction | 📋 Planned | Summarize old conversation |
| Context Pruning | 📋 Planned | Soft trim + hard clear |

### Phase 3: Session Lifecycle 📋 Future

| Feature | Status | Description |
|---------|--------|-------------|
| Session Management | 📋 Planned | Reset rules (daily, manual) |
| Session Transcripts | 📋 Planned | JSONL storage |
| Session Memory Hook | 📋 Planned | Auto-save on /new |
| Cache-TTL Pruning | 📋 Planned | Anthropic cache optimization |
| HTTP Adapter | 📋 Planned | Cloud n8n support |

## Available Tools

### `memory_search`

Search your memories using keyword matching.

```json
{
  "query": "project status",
  "maxResults": 5,
  "minScore": 0,
  "userId": "user_123"
}
```

> **Note:** `userId` will be added in Sprint 0. Currently all tools operate on a single shared workspace.

### `memory_get`

Read specific lines from a memory file.

```json
{
  "path": "memory/projects.md",
  "from": 1,
  "lines": 20,
  "userId": "user_123"
}
```

### `memory_store`

Create or update a memory file.

```json
{
  "path": "memory/profile.md",
  "content": "# Profile\nName: Maria\nCompany: TechCorp",
  "userId": "user_123"
}
```

### `memory_delete`

Delete a memory file.

```json
{
  "path": "memory/old-notes.md",
  "userId": "user_123"
}
```

## Development

```bash
# Install
pnpm install

# Build
pnpm build

# Test all packages
pnpm test

# Test MCP server only
cd packages/mcp-server
pnpm test:unit        # Unit tests (fast, recommended)
pnpm test:watch       # Watch mode for development

# Build and test MCP Server
pnpm build && pnpm test
```

See [Testing Guide](./docs/TESTING.md) and [Architecture](./docs/ARCHITECTURE.md) for detailed instructions.

## Current Limitations

| Limitation | Reason | Planned Solution |
|------------|--------|------------------|
| **No multi-user isolation** | **No userId parameter** | **Sprint 0: Per-user workspace + database** |
| Keyword search only | sqlite-vec not loaded | Phase 1.5: Vector search |
| No compaction | Not implemented yet | Phase 2: Compaction |
| Local n8n only | MCP uses stdio | Phase 3: HTTP adapter |
| No token metrics | Not implemented yet | Phase 2: Token counting |

## Contributing

Contributions are welcome! We especially need help with:

- **Sprint 0**: Multi-user isolation (userId per tool, per-user database)
- **Phase 1.5 features**: Vector search, hybrid merge
- **Testing**: Integration tests, multi-user isolation tests
- **Documentation**: Usage guides and examples
- **Integrations**: Claude Desktop, Cursor, WhatsApp workflows

### How to Contribute

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Project Structure

```
akashic-context/
├── packages/
│   ├── core/           # Core library (search, storage, chunking)
│   └── mcp-server/     # MCP Server for AI agents
├── examples/           # Example workspaces
├── docs/               # Documentation
└── test-workspace-mcp/ # Test workspace
```

## License

MIT License - See [LICENSE](./LICENSE) for details.

## Credits

Architecture inspired by [Moltbot](https://github.com/moltbot/moltbot), an open-source AI assistant.

## Author

**Tiago Santos** - [@tostechbr](https://github.com/tostechbr)

---

*Give your AI agents the gift of memory.*
