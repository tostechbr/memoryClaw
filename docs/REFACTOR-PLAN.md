# Refactor Plan - Standardize Architecture

## Problems Identified

### 1. ❌ Missing Unit Tests
```
packages/mcp-server/src/
├── index.ts       ✅ Implementation (memory_store, memory_delete)
└── index.test.ts  ❌ MISSING - No unit tests for handlers
```

### 2. ❌ Integration Tests in Wrong Location
```
packages/mcp-server/
├── test-simple.js         ❌ Should be in tests/integration/
├── test-memory-store.js   ❌ Should be in tests/integration/
└── test-memory-delete.js  ❌ Should be in tests/integration/
```

### 3. ❌ Inconsistent Test Format
- Current: `.js` files (raw Node.js scripts)
- Standard: `.test.ts` files (Vitest)

---

## Solution: 3-Step Refactor

### Step 1: Create Unit Tests ⏱️ 20 min

**File**: `packages/mcp-server/src/index.test.ts`

**Test Coverage**:
- ✅ handleMemoryStore (create, update, security)
- ✅ handleMemoryGet (existing, already working)
- ✅ handleMemoryDelete (delete, protect MEMORY.md)
- ✅ handleMemorySearch (existing, already working)

**Benefits**:
- Fast tests (no stdio overhead)
- Better isolation
- Easier debugging
- Follows project standard

---

### Step 2: Move Integration Tests ⏱️ 10 min

**Create directory structure**:
```bash
mkdir -p packages/mcp-server/tests/integration
mkdir -p packages/mcp-server/tests/fixtures
```

**Move files**:
```bash
# Move and rename
mv test-simple.js tests/integration/simple.test.ts
mv test-memory-store.js tests/integration/memory-store.test.ts
mv test-memory-delete.js tests/integration/memory-delete.test.ts
```

**Convert to Vitest**:
- Change from raw Node.js to Vitest
- Keep stdio testing approach
- Add proper assertions

---

### Step 3: Update Test Commands ⏱️ 5 min

**Update `package.json`**:
```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run src",
    "test:integration": "vitest run tests/integration",
    "test:watch": "vitest watch"
  }
}
```

**Run tests**:
```bash
pnpm test              # All tests
pnpm test:unit         # Only unit tests (fast)
pnpm test:integration  # Only integration tests (slower)
```

---

## Implementation Order

### Phase 1: Unit Tests (Priority 1)
1. Create `packages/mcp-server/src/index.test.ts`
2. Test `handleMemoryStore`
3. Test `handleMemoryDelete`
4. Test security validations
5. Run: `pnpm test:unit`

### Phase 2: Reorganize Integration Tests (Priority 2)
1. Create `tests/` directory structure
2. Convert `.js` to `.test.ts`
3. Update imports and assertions
4. Run: `pnpm test:integration`

### Phase 3: Documentation (Priority 3)
1. Update TESTING.md with new structure
2. Update README.md with test commands
3. Add ARCHITECTURE.md reference

---

## File-by-File Changes

### Create: `packages/mcp-server/src/index.test.ts`

```typescript
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { MemoryMcpServer } from "./index.js";
import fs from "node:fs/promises";
import path from "node:path";

describe("MemoryMcpServer", () => {
  let server: MemoryMcpServer;
  let testWorkspace: string;

  beforeEach(async () => {
    testWorkspace = path.join(process.cwd(), ".test-mcp");
    await fs.mkdir(testWorkspace, { recursive: true });

    server = new MemoryMcpServer({
      workspaceDir: testWorkspace,
      embedding: { provider: "openai", apiKey: "test-key" }
    });
  });

  afterEach(async () => {
    await server.close();
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  describe("handleMemoryStore", () => {
    test("creates new file", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/test.md",
        content: "# Test"
      });

      expect(result.content[0].text).toContain("success");
    });

    test("rejects path traversal", async () => {
      const result = await server["handleMemoryStore"]({
        path: "../../../etc/passwd",
        content: "hack"
      });

      expect(result.isError).toBe(true);
    });

    test("rejects non-.md files", async () => {
      const result = await server["handleMemoryStore"]({
        path: "file.txt",
        content: "test"
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("handleMemoryDelete", () => {
    test("deletes file", async () => {
      // Create file first
      await server["handleMemoryStore"]({
        path: "memory/temp.md",
        content: "temp"
      });

      // Delete it
      const result = await server["handleMemoryDelete"]({
        path: "memory/temp.md"
      });

      expect(result.content[0].text).toContain("success");
    });

    test("protects MEMORY.md", async () => {
      const result = await server["handleMemoryDelete"]({
        path: "MEMORY.md"
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("protected");
    });
  });
});
```

---

### Move: Integration Tests

**From**:
```
packages/mcp-server/test-simple.js
```

**To**:
```
packages/mcp-server/tests/integration/simple.test.ts
```

**Convert**:
```typescript
import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("MCP Server Integration", () => {
  test("lists all tools", async () => {
    const server = spawn("node", [resolve(__dirname, "../../dist/cli.js")], {
      env: {
        ...process.env,
        MEMORY_WORKSPACE_DIR: resolve(__dirname, "../../../test-workspace-mcp")
      },
      stdio: ["pipe", "pipe", "inherit"]
    });

    let buffer = "";

    const result = await new Promise((resolve) => {
      server.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");

        for (const line of lines) {
          if (line.includes("tools")) {
            resolve(JSON.parse(line));
            server.kill();
          }
        }
      });

      server.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      }) + "\n");
    });

    expect(result.result.tools).toHaveLength(4);
    expect(result.result.tools.map(t => t.name)).toContain("memory_store");
  });
});
```

---

## Validation Checklist

After refactor, verify:

- [ ] `pnpm test` runs all tests
- [ ] `pnpm test:unit` runs only unit tests
- [ ] `pnpm test:integration` runs only integration tests
- [ ] All tests pass
- [ ] No `.js` test files in root
- [ ] All tests use Vitest
- [ ] Test coverage > 70%

---

## Time Estimate

| Phase | Task | Time |
|-------|------|------|
| 1 | Create unit tests | 20 min |
| 2 | Move integration tests | 10 min |
| 3 | Convert to Vitest | 15 min |
| 4 | Update docs | 10 min |
| **Total** | | **55 min** |

---

## Benefits

### Before ❌
```
packages/mcp-server/
├── src/
│   └── index.ts               # No tests
├── test-simple.js             # Wrong location
├── test-memory-store.js       # Wrong location
└── test-memory-delete.js      # Wrong location
```

### After ✅
```
packages/mcp-server/
├── src/
│   ├── index.ts               # Implementation
│   └── index.test.ts          # Unit tests ⭐
└── tests/
    ├── integration/
    │   ├── simple.test.ts     # Organized ⭐
    │   ├── memory-store.test.ts
    │   └── memory-delete.test.ts
    └── fixtures/
```

---

## Next Action

**Option 1: Do it now (55 min)**
- Create unit tests
- Reorganize integration tests
- Update docs

**Option 2: Create GitHub issue**
- Document the refactor plan
- Prioritize for later
- Continue with Phase 2 (Vector Search)

**Recommendation**: Do it now to maintain consistency before adding more features.
