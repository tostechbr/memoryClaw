---
name: mcp-tool-patterns
description: Patterns for adding and modifying MCP tools in Akashic Context — Zod schemas, error handling, response format, and tool registration. Preload into agents modifying mcp-server/src/index.ts.
user-invocable: false
---

# MCP Tool Patterns — Akashic Context

## Tool Registration Pattern

Tools are registered in `setupToolHandlers()` inside `ListToolsRequestSchema` handler.
Each tool needs: `name`, `description`, `inputSchema` (JSON Schema).

```typescript
{
  name: "memory_context",
  description: "Get or set working memory (context.json) for a user.",
  inputSchema: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "User identifier (default: 'default')",
      },
      action: {
        type: "string",
        enum: ["get", "set"],
        description: "Get or set working memory",
      },
      data: {
        type: "object",
        description: "Data to set (only for action='set')",
      },
    },
    required: ["action"],
  },
},
```

## Handler Pattern (Zod validation)

All handlers use Zod for input validation:

```typescript
private async handleMemoryContext(args: unknown) {
  const schema = z.object({
    userId: z.string().optional().default("default"),
    action: z.enum(["get", "set"]),
    data: z.record(z.unknown()).optional(),
  });

  const { userId, action, data } = schema.parse(args);

  // implementation...
}
```

## Adding userId to Existing Tools

**Before** (hardcoded):
```typescript
// In constructor
this.manager = new MemoryManager({
  dataDir,
  userId: "mcp-user",   // hardcoded
  workspaceDir: config.workspaceDir,
  // ...
});
```

**After** (per-call userId):
The manager must be created per-call (or use a manager factory/cache).
Pattern: create MemoryManager per userId on demand, cache by userId.

```typescript
private managers = new Map<string, MemoryManager>();

private getManager(userId: string): MemoryManager {
  if (!this.managers.has(userId)) {
    const manager = new MemoryManager({
      dataDir: this.dataDir,
      userId,
      workspaceDir: this.workspaceDir,  // base dir, manager appends users/{userId}
      memory: this.memoryConfig,
    });
    if (this.embeddingConfig) {
      this.setupEmbeddingProviderForManager(manager, this.embeddingConfig);
    }
    this.managers.set(userId, manager);
  }
  return this.managers.get(userId)!;
}
```

## Success Response Pattern

```typescript
return {
  content: [{
    type: "text",
    text: JSON.stringify({ success: true, path: safePath, message: "..." }, null, 2),
  }],
};
```

## Error Response Pattern

```typescript
return {
  content: [{
    type: "text",
    text: "Error: <message>",
  }],
  isError: true,
};
```

## Switch Dispatch Pattern

In `CallToolRequestSchema` handler:

```typescript
switch (name) {
  case "memory_search":  return await this.handleMemorySearch(args);
  case "memory_get":     return await this.handleMemoryGet(args);
  case "memory_store":   return await this.handleMemoryStore(args);
  case "memory_delete":  return await this.handleMemoryDelete(args);
  case "memory_context": return await this.handleMemoryContext(args);  // new
  default:
    throw new Error(`Unknown tool: ${name}`);
}
```

## Adding userId Parameter to Existing Handlers

Minimal change — add optional `userId` to existing Zod schemas:

```typescript
// memory_search — before
const schema = z.object({
  query: z.string(),
  maxResults: z.number().optional().default(6),
  minScore: z.number().optional().default(0.35),
});

// memory_search — after
const schema = z.object({
  query: z.string(),
  maxResults: z.number().optional().default(6),
  minScore: z.number().optional().default(0.35),
  userId: z.string().optional().default("default"),  // add this
});
```

Then pass `userId` to `getManager(userId)` instead of using `this.manager`.

## Tool Description inputSchema Update

Add to each tool's `inputSchema.properties`:
```json
"userId": {
  "type": "string",
  "description": "User identifier for memory isolation (default: 'default')"
}
```
