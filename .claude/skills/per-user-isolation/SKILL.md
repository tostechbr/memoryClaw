---
name: per-user-isolation
description: Patterns for implementing per-user isolation in Akashic Context — directory structure, DB path conventions, workspace isolation, working memory (context.json). Preload into agents implementing Sprint 0.
user-invocable: false
---

# Per-User Isolation Patterns

## Target Directory Structure (Sprint 0)

```
{dataDir}/
└── users/
    ├── default/              <- no userId given = backward compatible
    │   ├── memory.db         <- isolated SQLite DB
    │   ├── MEMORY.md         <- main memory file
    │   ├── context.json      <- working memory (scratchpad)
    │   └── memory/
    │       └── *.md
    ├── user_123/
    │   ├── memory.db
    │   ├── MEMORY.md
    │   ├── context.json
    │   └── memory/*.md
    └── 5511999999999/        <- WhatsApp phone as userId
        └── ...
```

## Storage Layer Change (storage.ts)

**Current** (flat):
```typescript
const dbName = `memory_${config.userId}.db`;
this.dbPath = path.join(ensureDir(config.dataDir), dbName);
// Result: {dataDir}/memory_mcp-user.db
```

**Target** (per-user):
```typescript
const userDir = path.join(config.dataDir, "users", config.userId);
ensureDir(userDir);
this.dbPath = path.join(userDir, "memory.db");
// Result: {dataDir}/users/user_123/memory.db
```

## Manager Layer Change (manager.ts)

**Current** (shared workspace):
```typescript
const memoryFile = path.join(this.config.workspaceDir, "MEMORY.md");
const memoryDir = path.join(this.config.workspaceDir, "memory");
```

**Target** (per-user workspace):
The `workspaceDir` passed to MemoryManager should already be the user-specific dir.
Responsibility: the MCP server constructs the per-user workspaceDir before creating MemoryManager.

```typescript
// In mcp-server getManager(userId):
const userWorkspaceDir = path.join(this.baseWorkspaceDir, "users", userId);
await fs.mkdir(userWorkspaceDir, { recursive: true });
await fs.mkdir(path.join(userWorkspaceDir, "memory"), { recursive: true });

const manager = new MemoryManager({
  dataDir: this.dataDir,
  userId,
  workspaceDir: userWorkspaceDir,  // user-specific workspace
  memory: this.memoryConfig,
});
```

## Working Memory Interface (working-memory.ts)

```typescript
// packages/core/src/memory/working-memory.ts

export interface WorkingMemory {
  session_id?: string;
  active_topic?: string;
  last_interaction?: string;      // ISO 8601
  pending_decisions?: string[];
  entities_seen?: string[];
  updated_at: string;             // ISO 8601
}

const DEFAULT_WORKING_MEMORY: WorkingMemory = {
  updated_at: new Date().toISOString(),
};

export async function getWorkingMemory(workspaceDir: string): Promise<WorkingMemory> {
  const contextPath = path.join(workspaceDir, "context.json");
  try {
    const content = await fs.readFile(contextPath, "utf-8");
    return JSON.parse(content) as WorkingMemory;
  } catch {
    return { ...DEFAULT_WORKING_MEMORY };
  }
}

export async function setWorkingMemory(
  workspaceDir: string,
  data: Partial<WorkingMemory>
): Promise<WorkingMemory> {
  const current = await getWorkingMemory(workspaceDir);
  const updated: WorkingMemory = {
    ...current,
    ...data,
    updated_at: new Date().toISOString(),
  };
  const contextPath = path.join(workspaceDir, "context.json");
  await fs.writeFile(contextPath, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}
```

## Isolation Tests Pattern

```typescript
describe("Multi-user isolation", () => {
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), `akashic-test-${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  test("User A stores → User B cannot find", async () => {
    const serverA = createServer("user_A", testDataDir);
    const serverB = createServer("user_B", testDataDir);

    await serverA.store("memory/note.md", "Secret info for A");
    const results = await serverB.search("Secret info");

    expect(results.resultCount).toBe(0);
  });

  test("Default user works without userId", async () => {
    const server = createServer(undefined, testDataDir); // no userId
    await server.store("memory/note.md", "Hello default");
    const results = await server.search("Hello");
    expect(results.resultCount).toBeGreaterThan(0);
  });

  test("User A deletes → User B unaffected", async () => {
    // Both users have the same filename
    const serverA = createServer("user_A", testDataDir);
    const serverB = createServer("user_B", testDataDir);

    await serverA.store("memory/shared-name.md", "A content");
    await serverB.store("memory/shared-name.md", "B content");

    await serverA.delete("memory/shared-name.md");

    const results = await serverB.search("B content");
    expect(results.resultCount).toBeGreaterThan(0);
  });
});
```

## Backward Compatibility Rule

**ALWAYS**: `userId` is optional in all MCP tools.
If not provided, default to `"default"`.

```typescript
// Zod schema
userId: z.string().optional().default("default")

// This means existing n8n workflows without userId continue working:
// memory_search({ query: "projetos" })   // works, uses "default" user
// memory_search({ query: "projetos", userId: "5511..." })  // isolated user
```
