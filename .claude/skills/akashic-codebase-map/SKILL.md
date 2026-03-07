---
name: akashic-codebase-map
description: Complete map of the Akashic Context codebase — key files, types, conventions, and current implementation state. Preload into agents working on this project.
user-invocable: false
---

# Akashic Context — Codebase Map

## Project Structure

```
packages/
├── core/src/
│   ├── types.ts              <- Core interfaces: Message, MemoryConfig, MemoryChunk, Session
│   ├── index.ts              <- Main exports
│   ├── memory/
│   │   ├── manager.ts        <- MemoryManager class (orchestrates everything)
│   │   ├── storage.ts        <- MemoryStorage class (SQLite + FTS5)
│   │   ├── chunking.ts       <- chunkMarkdown() (~400 tokens, 80 overlap)
│   │   ├── hybrid.ts         <- mergeHybridResults() (70% vec + 30% keyword)
│   │   ├── manager.test.ts   <- Unit tests for MemoryManager
│   │   └── providers/
│   │       └── openai.ts     <- createOpenAIEmbeddingProvider()
│   └── utils/
│       ├── hash.ts           <- hashText(content): string
│       └── files.ts          <- listMemoryFiles(), exists(), ensureDir()
│
└── mcp-server/src/
    ├── index.ts              <- MemoryMcpServer class (4 MCP tools)
    ├── cli.ts                <- CLI entry point (env vars + args)
    └── index.test.ts         <- Unit tests for MCP server
```

## Key Classes and Interfaces

### `MemoryManagerConfig` (manager.ts)
```typescript
interface MemoryManagerConfig {
  dataDir: string;       // Where DBs are stored
  userId: string;        // User identifier
  sessionId?: string;    // Optional session scope
  workspaceDir: string;  // Where MEMORY.md + memory/*.md live
  memory: MemoryConfig;
  vectorExtensionPath?: string;
}
```

### `StorageConfig` (storage.ts)
```typescript
interface StorageConfig {
  dataDir: string;
  userId: string;
  sessionId?: string;
}
// Current DB path: {dataDir}/memory_{userId}.db
// Sprint 0 target: {dataDir}/users/{userId}/memory.db
```

### `MemoryStorage` constructor (storage.ts:85-92)
```typescript
constructor(config: StorageConfig) {
  const sessionPart = config.sessionId ? `_${config.sessionId}` : "";
  const dbName = `memory_${config.userId}${sessionPart}.db`;
  this.dbPath = path.join(ensureDir(config.dataDir), dbName);
  // ...
}
```

### `MemoryMcpServer` (mcp-server/index.ts)
- 4 tools: `memory_search`, `memory_get`, `memory_store`, `memory_delete`
- Currently hardcodes `userId: "mcp-user"` in constructor (line ~51)
- Zod schemas validate all input params
- Error responses use `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`

## Current State (Sprint 0 starts here)

| Component | State |
|-----------|-------|
| `userId` in `MemoryManagerConfig` | ✅ exists (uncommitted) |
| `userId` in `StorageConfig` | ✅ exists (uncommitted) |
| MCP tools expose `userId` param | ❌ hardcoded `"mcp-user"` |
| Per-user workspace directory | ❌ flat `workspaceDir/` |
| Per-user database path | ❌ flat `{dataDir}/memory_{userId}.db` |
| `working-memory.ts` | ❌ does not exist |
| `memory_context` MCP tool | ❌ does not exist |

## Conventions

- **TypeScript ESM strict** — always use `.js` extensions on imports
- **No `any`** — use explicit types
- **Files under ~500 LOC**
- **Tests colocated** — `*.test.ts` next to source
- **Utilities available**: `ensureDir(dir)`, `exists(path)`, `hashText(content)`, `listMemoryFiles(dir)`
- **Test command**: `pnpm test -- --run`
- **Build command**: `pnpm build`
- **140 tests currently passing** — must stay green

## Existing Tests Location

- `packages/core/src/memory/manager.test.ts` — MemoryManager unit tests
- `packages/mcp-server/src/index.test.ts` — MCP handler unit tests
- `packages/mcp-server/src/integration.test.ts` — End-to-end integration tests
